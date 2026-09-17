import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { decodeText, readSafeFile, safePath } from './filesystem.mjs';
import { candidateTree, excludedByPolicy, fail, protectedPath, relativePath } from './policy.mjs';
import { runOwnedProcess } from './process.mjs';

export async function git(root, args, limits, { input, accepted = [0] } = {}) {
  const result = await runOwnedProcess(
    'git',
    ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', ...args],
    {
      cwd: root,
      timeoutMs: limits.gitTimeoutMs,
      maxOutputBytes: limits.maxInventoryBytes,
      input,
      capture: true,
    },
  );
  if (
    !['passed', 'failed'].includes(result.status) ||
    !accepted.includes(result.exitCode) ||
    result.terminationFailed
  ) {
    fail(
      result.status === 'output-limit' ? 'limit-exceeded' : 'git-failed',
      `Read-only Git inventory failed (${result.status}, exit ${result.exitCode ?? 'none'}).`,
    );
  }
  return result.stdout;
}

function names(buffer) {
  if (buffer.length === 0) return [];
  if (buffer.at(-1) !== 0) fail('git-failed', 'Git did not return a NUL-delimited inventory.');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, -1));
  } catch {
    fail('unsafe-path', 'Git returned a path that is not valid UTF-8.');
  }
  return text.split('\0').map(relativePath);
}

export async function requireRepositoryRoot(root, limits) {
  const result = decodeText(
    await git(root, ['rev-parse', '--show-toplevel'], limits),
    '(repository root)',
  ).trim();
  const expected = root.replaceAll('\\', '/');
  const actual = result.replaceAll('\\', '/');
  if (
    (process.platform === 'win32' ? actual.toLowerCase() : actual) !==
    (process.platform === 'win32' ? expected.toLowerCase() : expected)
  ) {
    fail('not-repository-root', 'Run maintenance from the Git checkout root.');
  }
}

export async function dirtyStatus(root, limits) {
  return git(
    root,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'],
    limits,
  );
}

export async function ignoredPaths(root, paths, limits) {
  if (paths.length === 0) return new Set();
  const result = await git(root, ['check-ignore', '--no-index', '-z', '--stdin'], limits, {
    input: Buffer.from(`${paths.join('\0')}\0`),
    accepted: [0, 1],
  });
  return new Set(names(result));
}

async function prettierIgnoredPaths(root, paths, limits) {
  const ignored = new Set();
  const deadline = performance.now() + limits.gitTimeoutMs;
  for (let start = 0; start < paths.length;) {
    let end = start;
    let argumentLength = 0;
    while (end < paths.length && argumentLength + paths[end].length * 2 + 3 <= 16_000) {
      argumentLength += paths[end].length * 2 + 3;
      end += 1;
    }
    if (end === start)
      fail('limit-exceeded', 'An ignore path exceeds the bounded argument budget.');
    const batch = paths.slice(start, end);
    const remainingMs = Math.ceil(deadline - performance.now());
    if (remainingMs <= 0)
      fail('git-failed', 'Independent ignore evaluation exceeded its Git time limit.');
    // Without --exclude-standard, repository/global ignore negations cannot override this file.
    // Literal, bounded pathspecs avoid traversing ignored trees or exceeding Windows argv limits.
    const result = await git(
      root,
      [
        '--literal-pathspecs',
        'ls-files',
        '-z',
        '--cached',
        '--others',
        '--ignored',
        '--deduplicate',
        '--exclude-from',
        '.prettierignore',
        '--',
        ...batch,
      ],
      { ...limits, gitTimeoutMs: Math.min(limits.gitTimeoutMs, remainingMs) },
    );
    const requested = new Set(batch);
    for (const path of names(result)) {
      if (!requested.has(path))
        fail('git-failed', 'Ignore evaluation returned a non-inventoried path.');
      ignored.add(path);
    }
    start = end;
  }
  return ignored;
}

export async function inventory(root, limits, policy, hasPrettierIgnore) {
  const all = [
    ...new Set(
      names(
        await git(
          root,
          ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate'],
          limits,
        ),
      ),
    ),
  ].sort();
  if (all.length > limits.maxInventoryEntries) {
    fail('limit-exceeded', 'The Git inventory exceeds its entry limit.');
  }
  const gitIgnored = await ignoredPaths(root, all, limits);
  const readable = all.filter((path) => !gitIgnored.has(path) && !excludedByPolicy(path, policy));
  const prettierIgnored = hasPrettierIgnore
    ? await prettierIgnoredPaths(root, readable, limits)
    : new Set();
  const active = readable.filter((path) => !prettierIgnored.has(path));
  const aliases = new Set();
  for (const path of active) {
    const canonical = path.toLowerCase();
    if (aliases.has(canonical)) fail('unsafe-path', 'Case-colliding Git paths are not supported.');
    aliases.add(canonical);
    if (
      /(?:^|\/)(?:\.prettierrc(?:\.[^/]+)?|prettier\.config\.[^/]+)$/u.test(path) &&
      path !== '.prettierrc.json'
    ) {
      fail(
        'unsupported-formatter-config',
        'Only a root data-only .prettierrc.json is supported; other Prettier configurations are not executed.',
        path,
      );
    }
    if (candidateTree(path)) await safePath(root, path, { missing: true });
  }
  return { active, count: all.length, excludedCount: all.length - active.length };
}

export async function generatedPaths(root, paths, limits) {
  const generated = new Set();
  if (paths.length === 0) return generated;
  const output = await git(
    root,
    ['check-attr', '-z', '--stdin', 'linguist-generated', 'generated'],
    limits,
    { input: Buffer.from(`${paths.join('\0')}\0`) },
  );
  let fields;
  try {
    fields = new TextDecoder('utf-8', { fatal: true }).decode(output).split('\0');
  } catch {
    fail('git-failed', 'Git returned invalid attribute data.');
  }
  if (fields.pop() !== '' || fields.length !== paths.length * 6) {
    fail('git-failed', 'Git returned an incomplete generated-attribute queue.');
  }
  const requested = new Set(paths);
  for (let index = 0; index < fields.length; index += 3) {
    const [path, attribute, value] = fields.slice(index, index + 3);
    if (!requested.has(path) || !['linguist-generated', 'generated'].includes(attribute)) {
      fail('git-failed', 'Git returned unexpected generated-attribute data.');
    }
    if (!['unspecified', 'unset', 'false'].includes(value)) generated.add(path);
  }
  return generated;
}

export async function protectedFingerprint(root, paths, limits) {
  const hash = createHash('sha256');
  let bytes = 0;
  let files = 0;
  for (const path of paths.filter(protectedPath)) {
    const snapshot = await readSafeFile(root, path, limits.maxProtectedFileBytes, {
      optional: true,
    });
    if (!snapshot) continue;
    bytes += snapshot.content.length;
    files += 1;
    if (bytes > limits.maxProtectedBytes) {
      fail('limit-exceeded', 'Protected-input fingerprinting exceeds its byte limit.');
    }
    hash.update(path).update('\0');
    hash.update(createHash('sha256').update(snapshot.content).digest()).update('\0');
  }
  return { sha256: hash.digest('hex'), files, bytes };
}
