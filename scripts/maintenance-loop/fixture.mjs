import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  rmdir,
  symlink,
  unlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  assertMatches,
  decodeText,
  readSafeFile,
  replaceMatching,
  reserveArtifact,
  safePath,
  safeRoot,
} from '../maintenance/filesystem.mjs';
import { fail, MaintenanceError, relativePath } from '../maintenance/policy.mjs';
import { digestEntries, entrySummary, errorRecord, LOOP_LIMITS, sha256 } from './contract.mjs';

const equalPath = (left, right) =>
  process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;

function within(root, target) {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

const identity = (info) => ({ dev: info.dev, ino: info.ino });
const matchesIdentity = (info, expected) =>
  expected && info.dev === expected.dev && info.ino === expected.ino;

export async function canonicalRoot(path) {
  const info = await lstat(resolve(path));
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('unsafe-path', 'The source must be a real directory, not a junction or symlink.');
  }
  return safeRoot(await realpath(path));
}

export function nulNames(buffer) {
  if (!buffer.length) return [];
  if (buffer.at(-1) !== 0)
    fail('invalid-inventory', 'Git returned an incomplete NUL-delimited list.');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, -1));
  } catch {
    fail('invalid-inventory', 'Git returned a non-UTF-8 path.');
  }
  const names = [...new Set(text.split('\0').map(relativePath))].sort();
  if (
    names.length > LOOP_LIMITS.maxFiles ||
    new Set(names.map((path) => path.toLowerCase())).size !== names.length
  ) {
    fail('invalid-inventory', 'Git paths exceed the bound or contain case aliases.');
  }
  return names;
}

function historyPath(path) {
  return /^(?:hackathon(?:\/|$)|docs\/superpowers(?:\/|$))/iu.test(path);
}

function excludedReason(path) {
  const lower = path.toLowerCase();
  if (
    /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.netrc|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|id_(?:rsa|ed25519)|[^/]+\.(?:pem|key|pfx|p12))$/u.test(
      lower,
    )
  )
    return 'secret-path';
  if (
    /(?:^|\/)(?:\.copilot|\.codex|\.gemini|\.ssh|\.aws|\.azure|user-data|userdata|session-state|history)(?:\/|$)/u.test(
      lower,
    ) ||
    (lower.startsWith('.claude/') && lower !== '.claude/settings.json')
  )
    return 'private-data';
  if (
    /(?:^|\/)(?:\.git|\.hg|\.svn|node_modules|reports|coverage|out|dist|release|build|\.vite|\.cache|vendor|generated|_generated|_site|archive|archives)(?:\/|$)/u.test(
      lower,
    ) ||
    /(?:\.generated|\.min)\.|(?:\.log|\.tsbuildinfo)$/u.test(lower)
  )
    return 'generated-path';
  return null;
}

export async function writeNew(root, path, content) {
  const reserved = await reserveArtifact(root, path);
  return replaceMatching(root, reserved, Buffer.isBuffer(content) ? content : Buffer.from(content));
}

export class RunAllocationError extends MaintenanceError {
  constructor(cause, run, phase, cleanup, retainedPaths) {
    super(
      'allocation-failed',
      `Run allocation failed during ${phase}; acquired paths are recorded.`,
    );
    this.cause = cause;
    this.run = run;
    this.phase = phase;
    this.cleanup = cleanup;
    this.retainedPaths = retainedPaths;
  }
}

export async function retainedRunPaths(run) {
  const retained = [];
  for (const [role, path, expected] of [
    ['report', run.root, run.reportIdentity],
    ['scratch', run.scratch, run.scratchIdentity],
  ]) {
    if (!path) continue;
    try {
      const info = await lstat(path);
      retained.push({
        role,
        path,
        state:
          info.isDirectory() && !info.isSymbolicLink() && matchesIdentity(info, expected)
            ? 'present'
            : 'unverified',
      });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        retained.push({ role, path, state: 'unknown', error: errorRecord(error) });
      }
    }
  }
  return retained;
}

export async function verifyReportRoot(run) {
  if (!run.root || !run.reportIdentity) {
    fail(
      'allocation-ownership-unverified',
      'The allocated report directory identity is unavailable.',
    );
  }
  const location = await safePath(run.sourceRoot, run.relativePath);
  const root = await safeRoot(location.target);
  if (!equalPath(root, run.root) || !matchesIdentity(location.stat, run.reportIdentity)) {
    fail(
      'concurrent-edit',
      'The allocated report directory was replaced; publication was refused.',
    );
  }
  return root;
}

async function recoverAllocation(run) {
  if (!run.scratch) return { status: 'not-created' };
  try {
    if (run.owner) await removeScratch(run);
    else {
      // Before the marker is complete, initialization has not populated scratch.
      // Remove only a verified empty directory; preserve any unexpected contents.
      await rmdir(await verifyScratchLocation(run));
    }
    return { status: 'removed', path: run.scratch };
  } catch (error) {
    return { status: 'failed', path: run.scratch, error: errorRecord(error) };
  }
}

export async function createRunDirectory(sourceRoot, commands) {
  sourceRoot = await canonicalRoot(sourceRoot);
  const relativePath = `reports/maintenance-loop/${Date.now()}-${randomUUID()}`;
  await safePath(sourceRoot, relativePath, { missing: true });
  const ignored = nulNames(
    await commands.git(sourceRoot, ['check-ignore', '-z', '--stdin'], 'report-ignore-contract', {
      input: Buffer.from(`${relativePath}/receipt.json\0`),
      accepted: [0, 1],
    }),
  );
  if (!ignored.includes(`${relativePath}/receipt.json`)) {
    fail('unsafe-output', 'The verifier requires Git-ignored reports/maintenance-loop output.');
  }
  const location = await safePath(sourceRoot, relativePath, { missing: true, parents: true });
  if (location.stat) fail('output-exists', 'The unique run directory unexpectedly exists.');
  const tempRoot = await canonicalRoot(tmpdir());
  if (within(sourceRoot, tempRoot)) {
    fail('unsafe-temp-root', 'Temporary data must not be inside the source checkout.');
  }
  const parentRepository = await commands.git(
    tempRoot,
    ['rev-parse', '--show-toplevel'],
    'scratch-parent-not-repository',
    { accepted: [0, 128] },
  );
  if (parentRepository.length) {
    fail('unsafe-temp-root', 'Temporary data must not inherit a parent Git repository.');
  }
  const run = {
    schemaVersion: 1,
    sourceRoot,
    relativePath,
    tempRoot,
    root: null,
    reportIdentity: null,
    scratch: null,
    scratchIdentity: null,
    owner: null,
    home: null,
  };
  let phase = 'allocate-report';
  try {
    await mkdir(location.target);
    run.root = location.target;
    phase = 'identify-report';
    await safeRoot(run.root);
    run.reportIdentity = identity(await lstat(run.root));
    phase = 'allocate-scratch';
    run.scratch = await mkdtemp(join(tempRoot, 'parallel-agents-maintenance-loop-'));
    phase = 'identify-scratch';
    run.scratchIdentity = identity(await lstat(run.scratch));
    phase = 'write-owner';
    const lease = {
      schemaVersion: 1,
      sourceRoot,
      relativePath,
      tempRoot,
      scratch: run.scratch,
      scratchIdentity: run.scratchIdentity,
    };
    run.owner = await writeNew(run.root, 'owner.json', `${JSON.stringify(lease)}\n`);
    run.home = join(run.scratch, 'home');
    phase = 'prepare-home';
    for (const path of ['tmp', 'AppData/Roaming', 'AppData/Local', '.config', '.cache']) {
      await mkdir(join(run.home, ...path.split('/')), { recursive: true });
    }
    return run;
  } catch (cause) {
    const cleanup = await recoverAllocation(run);
    throw new RunAllocationError(cause, run, phase, cleanup, await retainedRunPaths(run));
  }
}

async function verifyScratchLocation(run) {
  if (!run.scratchIdentity) {
    fail(
      'allocation-ownership-unverified',
      'The allocated scratch identity is unavailable; no removal was attempted.',
    );
  }
  const scratch = await canonicalRoot(run.scratch);
  const tempRoot = await canonicalRoot(run.tempRoot);
  const sourceRoot = await canonicalRoot(run.sourceRoot);
  const stat = await lstat(scratch);
  if (
    !equalPath(dirname(scratch), tempRoot) ||
    !/^parallel-agents-maintenance-loop-[a-z0-9]+$/iu.test(basename(scratch)) ||
    within(sourceRoot, scratch) ||
    !matchesIdentity(stat, run.scratchIdentity)
  ) {
    fail('concurrent-edit', 'The owned scratch directory was replaced; cleanup was refused.');
  }
  return scratch;
}

export async function verifyScratch(run) {
  if (!run.owner) {
    fail('allocation-ownership-unverified', 'A complete scratch ownership marker is required.');
  }
  await assertMatches(run.root, run.owner, 8192);
  return verifyScratchLocation(run);
}

export async function removeScratch(run) {
  const scratch = await verifyScratch(run);
  for (const phase of ['positive', 'negative']) {
    const fixture = await safePath(scratch, phase, { missing: true });
    if (!fixture.stat) continue;
    const dependencyPath = join(fixture.target, 'node_modules');
    let info;
    try {
      info = await lstat(dependencyPath);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (
      !info.isSymbolicLink() ||
      !equalPath(
        await realpath(dependencyPath),
        await realpath(join(run.sourceRoot, 'node_modules')),
      )
    ) {
      fail('concurrent-edit', 'The fixture dependency link changed; cleanup was refused.');
    }
    await unlink(dependencyPath);
  }
  await rm(scratch, { recursive: true, force: false });
}

export async function captureCandidate(root, commands, label = 'candidate') {
  root = await canonicalRoot(root);
  const gitRoot = decodeText(
    await commands.git(root, ['rev-parse', '--show-toplevel'], `${label}-root`),
    'Git root',
  ).trim();
  if (!equalPath(root, await realpath(gitRoot)))
    fail('not-repository-root', 'Use the checkout root.');
  const commitResult = await commands.git(
    root,
    ['rev-parse', '--verify', 'HEAD'],
    `${label}-head`,
    { accepted: [0, 128] },
  );
  const commit = commitResult.toString('utf8').trim();
  const status = await commands.git(
    root,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    `${label}-status`,
  );
  const index = await commands.git(root, ['ls-files', '--stage', '-z'], `${label}-index`);
  const paths = nulNames(
    await commands.git(
      root,
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate'],
      `${label}-inventory`,
    ),
  );
  const ignored = new Set(
    paths.length
      ? nulNames(
          await commands.git(
            root,
            ['check-ignore', '--no-index', '-z', '--stdin'],
            `${label}-ignored`,
            { input: Buffer.from(`${paths.join('\0')}\0`), accepted: [0, 1] },
          ),
        )
      : [],
  );
  const excluded = [];
  const active = paths.filter((path) => {
    const reason = ignored.has(path) ? 'git-ignored' : excludedReason(path);
    if (reason) excluded.push({ path, reason });
    return !reason;
  });
  const generated = new Set();
  if (active.length) {
    const attributes = await commands.git(
      root,
      ['check-attr', '-z', '--stdin', 'linguist-generated', 'generated'],
      `${label}-attributes`,
      { input: Buffer.from(`${active.join('\0')}\0`) },
    );
    const fields = new TextDecoder('utf-8', { fatal: true }).decode(attributes).split('\0');
    if (fields.pop() !== '' || fields.length !== active.length * 6) {
      fail('invalid-inventory', 'Generated attributes did not cover the complete candidate.');
    }
    for (let index = 0; index < fields.length; index += 3) {
      if (
        fields[index] !== active[Math.floor(index / 6)] ||
        !['linguist-generated', 'generated'].includes(fields[index + 1])
      ) {
        fail('invalid-inventory', 'Git returned a mismatched generated-attribute queue.');
      }
      if (!['unspecified', 'unset', 'false'].includes(fields[index + 2]))
        generated.add(fields[index]);
    }
  }
  const entries = [];
  const missingPaths = [];
  const historyPaths = [];
  let bytes = 0;
  for (const path of active) {
    if (generated.has(path)) {
      excluded.push({ path, reason: 'generated-attribute' });
      continue;
    }
    const location = await safePath(root, path, { missing: true });
    if (!location.stat) {
      missingPaths.push(path);
      entries.push({ path, kind: 'missing', sha256: null, bytes: 0, executable: false });
      continue;
    }
    if (!location.stat.isFile())
      fail('unsafe-path', 'Git-visible directories or submodules cannot be copied.', path);
    const executable = Boolean(location.stat.mode & 0o111);
    if (historyPath(path)) {
      historyPaths.push(path);
      entries.push({ path, kind: 'history-path-only', sha256: null, bytes: 0, executable: false });
      continue;
    }
    const snapshot = await readSafeFile(root, path, LOOP_LIMITS.maxFileBytes);
    bytes += snapshot.content.length;
    if (bytes > LOOP_LIMITS.maxTotalBytes)
      fail('limit-exceeded', 'The candidate exceeds the copy byte budget.');
    entries.push({
      ...snapshot,
      kind: 'file',
      sha256: sha256(snapshot.content),
      bytes: snapshot.content.length,
      executable,
    });
  }
  return {
    root,
    commit: /^[a-f0-9]{40,64}$/u.test(commit) ? commit : null,
    statusSha256: sha256(status),
    indexSha256: sha256(index),
    contentSha256: digestEntries(entries),
    entries,
    files: entries.filter(({ kind }) => kind === 'file').length,
    bytes,
    missingPaths,
    historyPaths,
    excluded,
  };
}

export function candidateSummary(snapshot) {
  return {
    commit: snapshot.commit,
    contentSha256: snapshot.contentSha256,
    digestContract:
      'sha256 of ordered JSON path/kind/content-sha256/bytes/executable entries; missing paths and verified history topology are explicit, not source content',
    statusSha256: snapshot.statusSha256,
    indexSha256: snapshot.indexSha256,
    files: snapshot.files,
    bytes: snapshot.bytes,
    missingPaths: snapshot.missingPaths,
    historyPaths: snapshot.historyPaths,
    excludedCounts: Object.fromEntries(
      [...new Set(snapshot.excluded.map(({ reason }) => reason))]
        .sort()
        .map((reason) => [
          reason,
          snapshot.excluded.filter((entry) => entry.reason === reason).length,
        ]),
    ),
    entries: snapshot.entries.map(entrySummary),
  };
}

export async function copyCandidate(snapshot, destination) {
  destination = await canonicalRoot(destination);
  if ((await readdir(destination)).length)
    fail('unsafe-path', 'Candidate copies require a new empty directory.');
  for (const entry of snapshot.entries) {
    if (entry.kind === 'missing') continue;
    await writeNew(
      destination,
      entry.path,
      entry.kind === 'history-path-only' ? Buffer.alloc(0) : entry.content,
    );
    if (entry.executable) await chmod(join(destination, ...entry.path.split('/')), 0o700);
  }
}

export async function linkDependencies(sourceRoot, destination, commands) {
  const dependencies = await safePath(sourceRoot, 'node_modules');
  if (!dependencies.stat.isDirectory())
    fail(
      'missing-dependencies',
      'Reuse requires an existing node_modules directory; no install is performed.',
    );
  const target = join(destination, 'node_modules');
  const ignored = nulNames(
    await commands.git(
      destination,
      ['check-ignore', '--no-index', '-z', '--stdin'],
      'fixture-dependency-ignore',
      { input: Buffer.from('node_modules/.maintenance-loop-read-only\0'), accepted: [0, 1] },
    ),
  );
  if (!ignored.includes('node_modules/.maintenance-loop-read-only'))
    fail('unsafe-path', 'The dependency link must be Git-ignored.');
  await symlink(dependencies.target, target, process.platform === 'win32' ? 'junction' : 'dir');
  if (!equalPath(await realpath(target), dependencies.target)) {
    fail('unsafe-path', 'The dependency link did not resolve to the existing install.');
  }
}
