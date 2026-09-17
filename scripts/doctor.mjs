import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { commandFailure, isMain, parseOptions, resolveNpmCli, usage } from './dev-environment.mjs';
import { withoutRepositoryGitEnvironment } from './git-environment.mjs';

function versionParts(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}

function compatibleNode(value, minimum) {
  return (
    value !== null &&
    value[0] === minimum[0] &&
    (value[1] > minimum[1] || (value[1] === minimum[1] && value[2] >= minimum[2]))
  );
}

function readContract(root, manifest) {
  const nodePin = readFileSync(join(root, '.node-version'), 'utf8').trim();
  const node = manifest?.engines?.node;
  const npm = manifest?.engines?.npm;
  const nodeMinimum =
    typeof node === 'string' && node.startsWith('^') ? versionParts(node.slice(1)) : null;
  const npmBounds = typeof npm === 'string' ? /^>=(\d+)\s+<(\d+)$/.exec(npm) : null;
  // These are the repository's two engine forms, not a general semver implementation.
  if (
    !nodeMinimum ||
    nodeMinimum[0] < 1 ||
    !npmBounds ||
    Number(npmBounds[1]) >= Number(npmBounds[2])
  ) {
    throw new Error('Expected package engines.node "^X.Y.Z" (X >= 1) and engines.npm ">=N <M".');
  }
  if (!compatibleNode(versionParts(nodePin), nodeMinimum)) {
    throw new Error(
      `.node-version must pin a stable version compatible with engines.node ${node}.`,
    );
  }
  if (typeof manifest.scripts?.check !== 'string' || !manifest.scripts.check.trim()) {
    throw new Error('package.json must define the non-GUI validation script "check".');
  }
  return {
    requirements: { nodePin, node, npm },
    nodeMinimum,
    npmMinimum: Number(npmBounds[1]),
    npmMaximum: Number(npmBounds[2]),
  };
}

function inspectLockfile(root, manifest) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const lockedRoot = lock?.packages?.[''];
  if (lock?.lockfileVersion !== 3 || !lockedRoot || typeof lockedRoot !== 'object') {
    throw new Error('Expected package-lock.json lockfileVersion 3 with root package metadata.');
  }
  for (const field of ['name', 'version']) {
    if (lock[field] !== manifest?.[field] || lockedRoot[field] !== manifest?.[field]) {
      throw new Error(`package-lock.json ${field} differs from package.json; review the lockfile.`);
    }
  }
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'engines']) {
    if (!isDeepStrictEqual(lockedRoot[field] ?? {}, manifest?.[field] ?? {})) {
      throw new Error(
        `package-lock.json root ${field} differs from package.json; review the lockfile.`,
      );
    }
  }
}

export function diagnose({
  root = process.cwd(),
  env = process.env,
  nodeVersion = process.version,
  nodePath = process.execPath,
  platform = process.platform,
  arch = process.arch,
  npmCli,
  run = spawnSync,
} = {}) {
  root = resolve(root);
  const checks = [];
  const add = (id, required, status, message) => checks.push({ id, required, status, message });
  const options = {
    cwd: root,
    env: withoutRepositoryGitEnvironment(env),
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
    shell: false,
  };
  let contract;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    contract = readContract(root, manifest);
    add(
      'project',
      true,
      'pass',
      '.node-version and package.json define compatible tooling requirements.',
    );
  } catch (error) {
    add('project', true, 'fail', `Cannot validate project requirements: ${error.message}`);
  }

  const nodeCompatible =
    contract && compatibleNode(versionParts(nodeVersion), contract.nodeMinimum);
  add(
    'node',
    true,
    nodeCompatible
      ? nodeVersion.replace(/^v/, '') === contract.requirements.nodePin
        ? 'pass'
        : 'warn'
      : 'fail',
    contract
      ? `Node ${nodeVersion}; required ${contract.requirements.node}, reproducible pin ${contract.requirements.nodePin}.${nodeCompatible ? '' : ' Select the pinned Node version before setup.'}`
      : `Node ${nodeVersion}; cannot check the engine range until project requirements are repaired.`,
  );

  let resolvedNpm = null;
  try {
    resolvedNpm = resolveNpmCli(npmCli, env);
    const result = run(nodePath, [resolvedNpm.path, '--version'], options);
    const failure = commandFailure(result);
    if (failure) throw new Error(`npm --version failed (${failure}).`);
    const version = (result.stdout || '').trim();
    const parts = versionParts(version);
    const compatible =
      contract && parts && parts[0] >= contract.npmMinimum && parts[0] < contract.npmMaximum;
    add(
      'npm',
      true,
      compatible ? 'pass' : 'fail',
      `npm ${version || '(no version output)'} via ${resolvedNpm.source}: ${resolvedNpm.path}; required ${contract?.requirements.npm ?? '(project requirements unavailable)'}.${compatible ? '' : ' Install/select a compatible npm alongside Node; setup does not install global tools.'}`,
    );
  } catch (error) {
    add('npm', true, 'fail', error.message);
  }

  const git = run('git', ['--version'], options);
  const gitFailure = commandFailure(git);
  const gitVersion = (git.stdout || '').trim();
  add(
    'git',
    true,
    !gitFailure && /^git version \d+\.\d+/.test(gitVersion) ? 'pass' : 'fail',
    !gitFailure && /^git version \d+\.\d+/.test(gitVersion)
      ? `${gitVersion}; available on PATH.`
      : `Git is required on PATH. git --version failed (${gitFailure || 'unrecognized version output'}). Install/select Git yourself, then retry.`,
  );

  try {
    inspectLockfile(root, manifest);
    add(
      'lockfile',
      true,
      'pass',
      'Lockfile v3 root metadata matches package.json. npm ci validates the full dependency graph during installation.',
    );
  } catch (error) {
    add('lockfile', true, 'fail', error.message);
  }

  const supportedTooling =
    ['win32', 'linux', 'darwin'].includes(platform) && ['x64', 'arm64'].includes(arch);
  const nativeTarget = platform === 'win32' && arch === 'x64';
  add(
    'platform',
    true,
    !supportedTooling ? 'fail' : nativeTarget ? 'pass' : 'warn',
    nativeTarget
      ? 'Windows x64: supported desktop target. Setup runs non-GUI checks, not desktop/native smoke.'
      : `${platform}/${arch}: ${supportedTooling ? 'non-GUI checks/builds only; desktop support is not claimed' : 'not a supported bootstrap platform; use Windows x64 or Linux/macOS x64/arm64 for non-GUI tooling'}. Native desktop/smoke validation requires Windows x64.`,
  );
  add(
    'native-tools',
    false,
    'info',
    'Standard node-pty uses upstream N-API prebuilds. Visual Studio C++ Build Tools, matching Spectre libraries and Python are optional for explicit Windows source builds only; they are not probed, installed or required here. Do not run rebuild to fix an ordinary prebuilt install.',
  );
  add(
    'provider-auth',
    false,
    'info',
    'AI-provider CLIs, histories and authentication are not required or inspected for these local checks.',
  );
  return {
    schemaVersion: 1,
    ok: !checks.some((check) => check.required && check.status === 'fail'),
    root,
    requirements: contract?.requirements ?? null,
    npmCli: resolvedNpm,
    checks,
  };
}

export function formatDiagnostics(report) {
  return [
    `Developer prerequisites: ${report.ok ? 'ready' : 'NOT READY'}`,
    `Repository: ${report.root}`,
    ...report.checks.map(
      ({ id, status, required, message }) =>
        `[${status.toUpperCase()}] ${id}${required ? '' : ' (optional)'}: ${message}`,
    ),
  ].join('\n');
}

if (isMain(import.meta.url)) {
  let options;
  try {
    options = parseOptions(process.argv.slice(2), { allowJson: true });
  } catch (error) {
    console.error(`${error.message}\n${usage('doctor', { allowJson: true })}`);
    process.exitCode = 2;
  }
  if (options?.help) {
    console.log(usage('doctor', { allowJson: true }));
  } else if (options) {
    const report = diagnose(options);
    console.log(options.json ? JSON.stringify(report, null, 2) : formatDiagnostics(report));
    process.exitCode = report.ok ? 0 : 1;
  }
}
