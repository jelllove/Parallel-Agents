import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

import { fail, relativePath } from './policy.mjs';

function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function identity(stat) {
  return { dev: stat.dev, ino: stat.ino };
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

export async function safeRoot(path) {
  const root = resolve(path);
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(root, await realpath(root))) {
    fail('unsafe-path', 'The checkout root must be a real directory, not a symlink or junction.');
  }
  return root;
}

export async function safePath(root, path, { missing = false, parents = false } = {}) {
  relativePath(path);
  const parts = path.split('/');
  let target = root;
  for (let index = 0; index < parts.length; index += 1) {
    target = join(target, parts[index]);
    let stat;
    try {
      stat = await lstat(target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (parents && index < parts.length - 1) {
        try {
          await mkdir(target);
        } catch (mkdirError) {
          if (mkdirError.code !== 'EEXIST') throw mkdirError;
        }
        stat = await lstat(target);
      } else if (missing) {
        return { target: join(root, ...parts), stat: null };
      } else {
        throw error;
      }
    }
    if (
      stat.isSymbolicLink() ||
      (index < parts.length - 1 && !stat.isDirectory()) ||
      (stat.isFile() && stat.nlink !== 1)
    ) {
      fail(
        'unsafe-path',
        'Symlinks, junctions, hard links, and non-directory ancestors are not allowed.',
        path,
      );
    }
    const canonical = await realpath(target);
    const relativeTarget = relative(root, canonical);
    if (
      !samePath(canonical, target) ||
      relativeTarget === '..' ||
      relativeTarget.startsWith(`..${sep}`)
    ) {
      fail('unsafe-path', 'A path escapes or aliases the checkout.', path);
    }
    if (index === parts.length - 1) return { target, stat };
  }
}

async function readHandle(handle, maxBytes, path) {
  const before = await handle.stat();
  if (!before.isFile() || before.nlink !== 1) {
    fail('unsafe-path', 'Only regular, singly linked files are supported.', path);
  }
  if (before.size > maxBytes) fail('limit-exceeded', 'A file exceeds its byte limit.', path);
  const buffer = Buffer.alloc(before.size + 1);
  let length = 0;
  while (length < buffer.length) {
    const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
    if (bytesRead === 0) break;
    length += bytesRead;
  }
  const after = await handle.stat();
  if (
    length !== before.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs ||
    before.size !== after.size
  ) {
    fail('concurrent-edit', 'A file changed while it was being read.', path);
  }
  return { content: buffer.subarray(0, length), identity: identity(after) };
}

export async function readSafeFile(root, path, maxBytes, { optional = false } = {}) {
  const location = await safePath(root, path, { missing: optional });
  if (!location.stat && optional) return null;
  if (!location.stat?.isFile()) fail('unsafe-path', 'A candidate must be a regular file.', path);
  const handle = await open(location.target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!sameIdentity(location.stat, await handle.stat())) {
      fail('concurrent-edit', 'A file was replaced before it could be read.', path);
    }
    const snapshot = await readHandle(handle, maxBytes, path);
    const current = await safePath(root, path);
    if (!sameIdentity(snapshot.identity, current.stat)) {
      fail('concurrent-edit', 'A file was replaced during inspection.', path);
    }
    return { path, ...snapshot };
  } finally {
    await handle.close();
  }
}

export async function assertMatches(root, expected, maxBytes) {
  const current = await readSafeFile(root, expected.path, maxBytes);
  if (
    !sameIdentity(expected.identity, current.identity) ||
    !expected.content.equals(current.content)
  ) {
    fail('concurrent-edit', 'A file no longer matches the inspected content.', expected.path);
  }
}

export async function replaceMatching(root, expected, content, onProgress = () => {}) {
  const location = await safePath(root, expected.path);
  const handle = await open(location.target, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = await readHandle(
      handle,
      Math.max(expected.content.length, content.length),
      expected.path,
    );
    if (
      !sameIdentity(expected.identity, current.identity) ||
      !expected.content.equals(current.content)
    ) {
      fail('concurrent-edit', 'Refusing to overwrite a concurrent edit.', expected.path);
    }
    await assertMatches(root, expected, Math.max(expected.content.length, content.length));
    let written = 0;
    onProgress({ ...expected });
    while (written < content.length) {
      const { bytesWritten } = await handle.write(
        content,
        written,
        content.length - written,
        written,
      );
      if (bytesWritten === 0) fail('write-failed', 'A write made no progress.', expected.path);
      written += bytesWritten;
      onProgress({
        ...expected,
        content: Buffer.concat([content.subarray(0, written), expected.content.subarray(written)]),
      });
    }
    await handle.truncate(content.length);
    const final = { ...expected, content };
    onProgress(final);
    await handle.sync();
    await assertMatches(root, final, content.length);
    return final;
  } finally {
    await handle.close();
  }
}

export function artifactPath(value, extension) {
  if (typeof value !== 'string') fail('unsafe-output', 'Artifact paths must be relative strings.');
  const path = relativePath(value.replaceAll('\\', '/'));
  if (
    !path.startsWith('reports/maintenance/') ||
    !path.endsWith(extension) ||
    path.split('/').some((part) => !/^[a-z0-9][a-z0-9._-]*$/iu.test(part))
  ) {
    fail('unsafe-output', `New ${extension} artifacts must be under reports/maintenance.`);
  }
  return path;
}

export async function reserveArtifact(root, path) {
  const before = await safePath(root, path, { missing: true, parents: true });
  if (before.stat)
    fail('output-exists', 'An artifact target already exists; choose a new path.', path);
  const handle = await open(
    before.target,
    constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    const current = await safePath(root, path);
    const stat = await handle.stat();
    if (!sameIdentity(current.stat, stat)) {
      fail('concurrent-edit', 'An artifact target was replaced while being reserved.', path);
    }
    return { path, content: Buffer.alloc(0), identity: identity(stat) };
  } finally {
    await handle.close();
  }
}

export function decodeText(content, path) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content);
    if (text.includes('\0')) throw new Error('binary');
    return text;
  } catch {
    fail('invalid-text', 'Only valid, NUL-free UTF-8 text can be formatted.', path);
  }
}
