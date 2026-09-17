import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { git, ignoredPaths } from '../maintenance/inventory.mjs';
import {
  decodeText,
  readSafeFile,
  replaceMatching,
  reserveArtifact,
  safeRoot,
} from '../maintenance/filesystem.mjs';
import { LIMITS, relativePath } from '../maintenance/policy.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const origins = new Set(['workflow-step-outcomes', 'local-command', 'local-maintenance-fixture']);
const maxArtifactBytes = 4 * 1024 * 1024;
const sourceScope =
  'Git-visible current content; ignored/generated output and historical Hackathon/design media excluded.';

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
  );
}

async function repositoryRoot(directory) {
  if ((await lstat(directory)).isSymbolicLink())
    throw new Error('Evidence root must not be a symlink or junction.');
  return safeRoot(await realpath(directory));
}

function parseNames(buffer) {
  if (!buffer.length) return [];
  if (buffer.at(-1) !== 0) throw new Error('Incomplete Git source inventory.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, -1));
  return [...new Set(text.split('\0').map(relativePath))].sort();
}

function included(path) {
  return (
    !/^(?:reports|out|release|dist|coverage|node_modules|Hackathon|\.git|\.vite)(?:\/|$)/.test(
      path,
    ) && !path.startsWith('docs/superpowers/')
  );
}

function validSource(source) {
  return (
    exactKeys(source, ['commit', 'contentSha256', 'dirty', 'paths', 'scope']) &&
    /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(source.commit) &&
    hashPattern.test(source.contentSha256) &&
    typeof source.dirty === 'boolean' &&
    Array.isArray(source.paths) &&
    source.paths.length <= LIMITS.maxInventoryEntries &&
    source.paths.every(
      (path, index) => typeof path === 'string' && (index === 0 || source.paths[index - 1] < path),
    ) &&
    source.scope === sourceScope
  );
}

function evidencePath(path, { artifact = false } = {}) {
  if (typeof path !== 'string') throw new Error('Evidence paths must be relative strings.');
  relativePath(path);
  if (
    !/^reports\/(?:validation|agent-validation|maintenance-loop)\/[a-z0-9][a-z0-9._/-]*$/i.test(
      path,
    ) ||
    !(artifact ? /\.(?:json|xml|lcov|patch)$/ : /(?:^|\/)(?:[a-z0-9-]*-)?evidence\.json$/i).test(
      path,
    )
  ) {
    throw new Error('Evidence is restricted to known report directories and artifact types.');
  }
  return path;
}

export async function captureCandidate(directory) {
  const root = await repositoryRoot(directory);
  const commit = decodeText(
    await git(root, ['rev-parse', '--verify', 'HEAD'], LIMITS),
    'Git HEAD',
  ).trim();
  const names = parseNames(
    await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], LIMITS),
  );
  if (names.length > LIMITS.maxInventoryEntries)
    throw new Error('Source inventory exceeds its entry limit.');
  const excluded = await ignoredPaths(root, names, LIMITS);
  const paths = names.filter((path) => included(path) && !excluded.has(path));
  const hash = createHash('sha256');
  let bytes = 0;
  for (const path of paths) {
    const file = await readSafeFile(root, path, LIMITS.maxProtectedFileBytes, { optional: true });
    hash.update(path).update('\0');
    if (!file) {
      hash.update('missing\0');
      continue;
    }
    bytes += file.content.length;
    if (bytes > LIMITS.maxProtectedBytes)
      throw new Error('Source fingerprint exceeds its byte limit.');
    hash.update(digest(file.content)).update('\0');
  }
  const dirty =
    (await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], LIMITS))
      .length !== 0;
  return {
    commit,
    contentSha256: hash.digest('hex'),
    dirty,
    paths,
    scope: sourceScope,
  };
}

function sameSource(expected, current) {
  return (
    expected.commit === current.commit &&
    expected.contentSha256 === current.contentSha256 &&
    expected.dirty === current.dirty &&
    JSON.stringify(expected.paths) === JSON.stringify(current.paths)
  );
}

export async function sealEvidence(directory, { source, origin, artifacts, output }) {
  const root = await repositoryRoot(directory);
  if (!validSource(source) || !origins.has(origin))
    throw new Error('Invalid source provenance or evidence origin.');
  if (
    !Array.isArray(artifacts) ||
    !artifacts.length ||
    artifacts.length > 64 ||
    new Set(artifacts).size !== artifacts.length
  ) {
    throw new Error('Expected one to 64 unique evidence artifacts.');
  }
  evidencePath(output);
  const allPaths = [output, ...artifacts.map((path) => evidencePath(path, { artifact: true }))];
  if (!(await ignoredPaths(root, allPaths, LIMITS)).has(output))
    throw new Error('Evidence output must be Git-ignored.');
  if (!sameSource(source, await captureCandidate(root)))
    throw new Error('Source no longer matches the validation checkpoint.');
  const entries = [];
  for (const path of artifacts) {
    if (path === output) throw new Error('Evidence cannot contain itself.');
    const file = await readSafeFile(root, path, maxArtifactBytes);
    entries.push({ path, sha256: digest(file.content), bytes: file.content.length });
  }
  const envelope = {
    schemaVersion: 1,
    origin,
    generatedAt: new Date().toISOString(),
    source: structuredClone(source),
    artifacts: entries,
    independentExecutionProof: false,
  };
  const reserved = await reserveArtifact(root, output);
  await replaceMatching(root, reserved, Buffer.from(JSON.stringify(envelope, null, 2) + '\n'));
  return envelope;
}

export async function verifyEvidence(directory, path) {
  const root = await repositoryRoot(directory);
  evidencePath(path);
  const file = await readSafeFile(root, path, maxArtifactBytes);
  const envelope = JSON.parse(decodeText(file.content, path));
  if (
    !exactKeys(envelope, [
      'schemaVersion',
      'origin',
      'generatedAt',
      'source',
      'artifacts',
      'independentExecutionProof',
    ]) ||
    envelope.schemaVersion !== 1 ||
    !origins.has(envelope.origin) ||
    !validSource(envelope.source) ||
    typeof envelope.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(envelope.generatedAt)) ||
    envelope.independentExecutionProof !== false ||
    !Array.isArray(envelope.artifacts) ||
    !envelope.artifacts.length ||
    envelope.artifacts.length > 64
  ) {
    throw new Error('Invalid or unsupported evidence envelope.');
  }
  const artifactPaths = new Set();
  for (const item of envelope.artifacts) {
    if (
      !exactKeys(item, ['path', 'sha256', 'bytes']) ||
      !hashPattern.test(item.sha256) ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 0 ||
      item.bytes > maxArtifactBytes
    ) {
      throw new Error('Invalid artifact digest or length.');
    }
    if (artifactPaths.has(item.path)) throw new Error('Duplicate evidence artifact path.');
    artifactPaths.add(item.path);
    evidencePath(item.path, { artifact: true });
    const artifact = await readSafeFile(root, item.path, maxArtifactBytes);
    if (digest(artifact.content) !== item.sha256 || artifact.content.length !== item.bytes) {
      throw new Error(`Evidence artifact does not match its recorded digest: ${item.path}`);
    }
  }
  if (!sameSource(envelope.source, await captureCandidate(root))) {
    throw new Error('Current source does not match the evidence checkpoint.');
  }
  return { ...envelope, sourceMatches: true, artifactsMatch: true };
}
