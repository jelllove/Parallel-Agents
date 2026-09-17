import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import './helpers/isolated-git.mjs';
import { diagnose, formatDiagnostics } from '../scripts/doctor.mjs';
import { setup } from '../scripts/setup.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const doctorScript = join(repository, 'scripts', 'doctor.mjs');
const setupScript = join(repository, 'scripts', 'setup.mjs');
const engines = { node: '^24.17.0', npm: '>=11 <12' };

async function fixture(t) {
  const artifacts = join(repository, 'reports');
  await mkdir(artifacts, { recursive: true });
  const root = await mkdtemp(join(artifacts, 'dev-environment-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const manifest = {
    name: 'onboarding-fixture',
    version: '1.0.0',
    engines,
    scripts: { check: 'node -e "process.exit(0)"' },
    dependencies: { 'fixture-dependency': '1.0.0' },
    devDependencies: {},
  };
  const lock = {
    name: manifest.name,
    version: manifest.version,
    lockfileVersion: 3,
    packages: {
      '': {
        name: manifest.name,
        version: manifest.version,
        engines,
        dependencies: manifest.dependencies,
        devDependencies: {},
      },
      'node_modules/fixture-dependency': { version: '1.0.0' },
    },
  };
  const npmCli = join(root, 'tools with spaces', 'npm-cli.js');
  const files = {
    'package.json': JSON.stringify(manifest),
    'package-lock.json': JSON.stringify(lock),
    '.node-version': '24.17.0\n',
    'src/unchanged.ts': 'export const unchanged = true;\n',
    '.git/config': '[core]\n\thooksPath = preserve-this-policy\n',
    'user-config.json': '{"preserve":true}\n',
  };
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, ...name.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
  await mkdir(dirname(npmCli), { recursive: true });
  await writeFile(
    npmCli,
    [
      "const { appendFileSync } = require('node:fs');",
      'const args = process.argv.slice(2);',
      "if (args[0] === '--version') console.log(process.env.FIXTURE_NPM_VERSION || '11.13.0');",
      'else {',
      "  appendFileSync(process.env.FIXTURE_NPM_LOG, JSON.stringify(args) + '\\n');",
      '  if (process.env.FIXTURE_NPM_FAIL === args[0]) process.exit(7);',
      "  console.log('Fixture npm command: ' + args.join(' '));",
      '}',
    ].join('\n'),
  );
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'git' && args.join(' ') === '--version') {
      return { status: 0, stdout: 'git version 2.53.0.windows.1\n' };
    }
    assert.equal(command, process.execPath, 'npm must run through Node, never npm.cmd or a shell');
    assert.equal(args[0], npmCli);
    return { status: 0, stdout: args[1] === '--version' ? '11.13.0\n' : '' };
  };
  return {
    root,
    npmCli,
    manifest,
    lock,
    files,
    calls,
    options: {
      root,
      env: { npm_execpath: npmCli },
      nodeVersion: 'v24.17.0',
      nodePath: process.execPath,
      platform: 'win32',
      arch: 'x64',
      run,
    },
  };
}

function check(report, id) {
  const result = report.checks.find((entry) => entry.id === id);
  assert.ok(result, `Missing diagnostic: ${id}`);
  return result;
}

function cli(script, root, args = [], extraEnv = {}) {
  const env = { ...process.env, HOME: root, USERPROFILE: root, ...extraEnv };
  delete env.npm_execpath;
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
    shell: false,
  });
}

test('doctor derives requirements, checks versions and lock metadata without provider/tool installation', async (t) => {
  const state = await fixture(t);
  const report = diagnose(state.options);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.ok, true);
  assert.deepEqual(report.requirements, { nodePin: '24.17.0', ...engines });
  assert.deepEqual(report.npmCli, { path: state.npmCli, source: 'npm_execpath' });
  for (const id of ['project', 'node', 'npm', 'git', 'lockfile', 'platform']) {
    assert.equal(check(report, id).status, 'pass');
    assert.equal(check(report, id).required, true);
  }
  assert.equal(check(report, 'native-tools').required, false);
  assert.match(check(report, 'native-tools').message, /prebuild/i);
  assert.match(check(report, 'native-tools').message, /Spectre/i);
  assert.match(check(report, 'provider-auth').message, /not required/i);
  assert.deepEqual(
    state.calls.map(({ command, args }) => [command, args]),
    [
      [process.execPath, [state.npmCli, '--version']],
      ['git', ['--version']],
    ],
  );
  for (const { options } of state.calls) {
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.equal(options.timeout, 10_000);
    assert.equal(options.cwd, state.root);
  }
  assert.match(formatDiagnostics(report), /ready/i);
});

for (const [version, status] of [
  ['v24.17.0', 'pass'],
  ['v24.18.0', 'warn'],
  ['v24.16.9', 'fail'],
  ['v25.0.0', 'fail'],
  ['v22.22.0', 'fail'],
  ['v24.17.0-rc.1', 'fail'],
  ['not-a-version', 'fail'],
]) {
  test(`Node ${version} produces ${status} against the repository pin/range`, async (t) => {
    const { options } = await fixture(t);
    const report = diagnose({ ...options, nodeVersion: version });
    assert.equal(check(report, 'node').status, status);
    assert.equal(report.ok, status !== 'fail');
  });
}

for (const [version, ok] of [
  ['11.0.0', true],
  ['11.13.0', true],
  ['10.9.0', false],
  ['12.0.0', false],
  ['11.1.0-beta.1', false],
  ['unexpected output', false],
]) {
  test(`npm ${version} is checked against package engines`, async (t) => {
    const { options } = await fixture(t);
    const run = (command, args, settings) =>
      args[1] === '--version'
        ? { status: 0, stdout: `${version}\n` }
        : options.run(command, args, settings);
    const report = diagnose({ ...options, run });
    assert.equal(report.ok, ok);
    assert.equal(check(report, 'npm').status, ok ? 'pass' : 'fail');
  });
}

test('direct Node invocation needs an explicit npm CLI and never guesses or shells out to npm.cmd', async (t) => {
  const { options, calls } = await fixture(t);
  const report = diagnose({ ...options, env: {} });
  assert.equal(report.ok, false);
  assert.match(check(report, 'npm').message, /npm run doctor/);
  assert.match(check(report, 'npm').message, /--npm-cli/);
  assert.ok(calls.every(({ command }) => command === 'git'));
});

test('explicit absolute npm CLI overrides npm_execpath, including paths with spaces', async (t) => {
  const { options, npmCli } = await fixture(t);
  const report = diagnose({
    ...options,
    npmCli,
    env: { npm_execpath: join(options.root, 'missing', 'npm-cli.js') },
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.npmCli, { path: npmCli, source: '--npm-cli' });
  assert.equal(isAbsolute(report.npmCli.path), true);
});

for (const kind of ['relative', 'missing', 'directory', 'cmd']) {
  test(`invalid ${kind} npm CLI fails clearly without a fallback`, async (t) => {
    const { options, root, calls } = await fixture(t);
    let npmCli = 'npm-cli.js';
    if (kind === 'missing') npmCli = join(root, 'missing', 'npm-cli.js');
    if (kind === 'directory') {
      npmCli = join(root, 'directory', 'npm-cli.js');
      await mkdir(npmCli, { recursive: true });
    }
    if (kind === 'cmd') {
      npmCli = join(root, 'npm.cmd');
      await writeFile(npmCli, '@echo off\n');
    }
    const report = diagnose({ ...options, npmCli });
    assert.equal(report.ok, false);
    assert.equal(check(report, 'npm').status, 'fail');
    assert.ok(calls.every(({ command }) => command === 'git'));
  });
}

for (const command of ['git', 'npm']) {
  for (const result of [
    { error: { code: 'ENOENT', message: 'not found' }, status: null },
    { error: { code: 'ETIMEDOUT', message: 'timed out' }, status: null },
    { signal: 'SIGTERM', status: null },
    { status: 9, stderr: 'command failed' },
    { status: 0, stdout: '' },
  ]) {
    test(`doctor reports ${command} failure: ${JSON.stringify(result)}`, async (t) => {
      const { options } = await fixture(t);
      const run = (file, args, settings) =>
        (command === 'git' ? file === 'git' : file === process.execPath)
          ? result
          : options.run(file, args, settings);
      const report = diagnose({ ...options, run });
      assert.equal(report.ok, false);
      assert.equal(check(report, command).status, 'fail');
      assert.match(formatDiagnostics(report), /FAIL/);
    });
  }
}

for (const file of ['package.json', '.node-version', 'package-lock.json']) {
  for (const invalid of ['missing', 'malformed']) {
    test(`doctor reports ${invalid} ${file} without throwing`, async (t) => {
      const { root, options } = await fixture(t);
      if (invalid === 'missing') await rm(join(root, file));
      else await writeFile(join(root, file), 'invalid');
      const report = diagnose(options);
      assert.equal(report.ok, false);
      assert.equal(
        check(report, file === 'package-lock.json' ? 'lockfile' : 'project').status,
        'fail',
      );
    });
  }
}

for (const mutation of ['node-range', 'npm-range', 'pin', 'check-script']) {
  test(`unsupported or inconsistent project contract: ${mutation}`, async (t) => {
    const { root, manifest, options } = await fixture(t);
    manifest.engines = { ...engines };
    if (mutation === 'node-range') manifest.engines.node = '>=24';
    if (mutation === 'npm-range') manifest.engines.npm = '^11';
    if (mutation === 'pin') await writeFile(join(root, '.node-version'), '25.0.0\n');
    if (mutation === 'check-script') delete manifest.scripts.check;
    await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
    assert.equal(check(diagnose(options), 'project').status, 'fail');
  });
}

test('requirements follow compatible manifest/pin updates rather than hardcoded versions', async (t) => {
  const { root, manifest, lock, options } = await fixture(t);
  manifest.engines = { node: '^26.1.0', npm: '>=12 <13' };
  lock.packages[''].engines = manifest.engines;
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'package-lock.json'), JSON.stringify(lock));
  await writeFile(join(root, '.node-version'), '26.2.0\n');
  const run = (command, args, settings) =>
    args[1] === '--version'
      ? { status: 0, stdout: '12.0.0\n' }
      : options.run(command, args, settings);
  const report = diagnose({ ...options, nodeVersion: 'v26.2.0', run });
  assert.equal(report.ok, true);
  assert.deepEqual(report.requirements, { nodePin: '26.2.0', ...manifest.engines });
});

for (const mutation of ['version', 'root', 'name', 'dependencies', 'devDependencies', 'engines']) {
  test(`doctor rejects stale/incomplete lock metadata: ${mutation}`, async (t) => {
    const { root, lock, options } = await fixture(t);
    if (mutation === 'version') lock.lockfileVersion = 2;
    else if (mutation === 'root') delete lock.packages[''];
    else if (mutation === 'name') lock.packages[''].name = 'different-project';
    else lock.packages[''][mutation] = { wrong: 'value' };
    await writeFile(join(root, 'package-lock.json'), JSON.stringify(lock));
    assert.equal(check(diagnose(options), 'lockfile').status, 'fail');
  });
}

for (const [platform, arch, status] of [
  ['win32', 'x64', 'pass'],
  ['linux', 'x64', 'warn'],
  ['linux', 'arm64', 'warn'],
  ['darwin', 'arm64', 'warn'],
  ['win32', 'arm64', 'warn'],
  ['freebsd', 'x64', 'fail'],
  ['win32', 'ia32', 'fail'],
]) {
  test(`platform ${platform}/${arch} distinguishes non-GUI tooling from native desktop support`, async (t) => {
    const { options } = await fixture(t);
    const report = diagnose({ ...options, platform, arch });
    assert.equal(check(report, 'platform').status, status);
    assert.equal(report.ok, status !== 'fail');
    if (status === 'warn') assert.match(check(report, 'platform').message, /non-GUI/);
  });
}

test('setup uses locked ci then the existing non-mutating check gate and preserves fixture data', async (t) => {
  const { options, calls, npmCli, root, files } = await fixture(t);
  const messages = [];
  const result = setup({ ...options, log: (line) => messages.push(line) });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.completed, ['npm ci', 'npm run check']);
  const steps = calls.filter(({ args }) => args[0] === npmCli && args[1] !== '--version');
  assert.deepEqual(
    steps.map(({ args }) => args),
    [
      [
        npmCli,
        'ci',
        '--include=dev',
        '--include=optional',
        '--ignore-scripts=false',
        '--no-audit',
        '--no-fund',
      ],
      [npmCli, 'run', 'check'],
    ],
  );
  for (const { options: commandOptions } of steps) {
    assert.equal(commandOptions.cwd, root);
    assert.equal(commandOptions.shell, false);
    assert.equal(commandOptions.stdio, 'inherit');
    assert.equal(commandOptions.timeout, 900_000);
  }
  for (const [file, content] of Object.entries(files)) {
    assert.equal(await readFile(join(root, ...file.split('/')), 'utf8'), content);
  }
  assert.match(messages.join('\n'), /hooks/i);
  assert.match(messages.join('\n'), /native/i);
});

test('setup does not install anything if a mandatory prerequisite fails', async (t) => {
  const { options, calls } = await fixture(t);
  const result = setup({ ...options, nodeVersion: 'v22.0.0', log: () => {} });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.completed, []);
  assert.ok(calls.every(({ args }) => args.includes('--version')));
});

for (const operation of ['doctor', 'setup']) {
  test(`${operation} removes inherited repository Git variables without changing caller environment or fixture index`, async (t) => {
    const { root, options, calls } = await fixture(t);
    const index = join(root, 'caller-index');
    await writeFile(index, 'preserve caller index bytes\n');
    const inherited = {
      GIT_INDEX_FILE: index,
      GIT_DIR: join(root, 'caller-git'),
      GIT_WORK_TREE: join(root, 'caller-worktree'),
      GIT_COMMON_DIR: join(root, 'caller-common'),
      gIt_PrEfIx: 'caller-prefix',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: join(root, 'caller-hooks'),
    };
    const env = Object.freeze({
      ...options.env,
      ...inherited,
      SAFE_SETTING: 'preserve this value',
    });
    const result =
      operation === 'doctor'
        ? diagnose({ ...options, env })
        : setup({ ...options, env, log: () => {} });
    assert.equal(operation === 'doctor' ? result.ok : result.exitCode === 0, true);
    for (const { options: child } of calls) {
      for (const name of Object.keys(inherited)) {
        assert.equal(Object.hasOwn(child.env, name), false, `Child inherited ${name}`);
        assert.equal(env[name], inherited[name], `Caller environment changed: ${name}`);
      }
      assert.equal(child.env.SAFE_SETTING, 'preserve this value');
      assert.equal(child.env.npm_execpath, options.env.npm_execpath);
    }
    assert.equal(await readFile(index, 'utf8'), 'preserve caller index bytes\n');
    if (operation === 'setup') assert.deepEqual(result.completed, ['npm ci', 'npm run check']);
  });
}

for (const step of ['ci', 'run']) {
  for (const failure of [
    { status: 7 },
    { status: null, error: { code: 'ENOENT', message: 'missing executable' } },
    { status: null, error: { code: 'ETIMEDOUT', message: 'timed out' } },
    { status: null, signal: 'SIGTERM' },
  ]) {
    test(`setup stops at ${step} failure: ${JSON.stringify(failure)}`, async (t) => {
      const { options, calls } = await fixture(t);
      const run = (command, args, settings) => {
        const success = options.run(command, args, settings);
        return args[1] === step ? failure : success;
      };
      const result = setup({ ...options, run, log: () => {} });
      assert.equal(result.exitCode, failure.status || 1);
      assert.deepEqual(result.completed, step === 'ci' ? [] : ['npm ci']);
      if (step === 'ci') assert.ok(calls.every(({ args }) => args[1] !== 'run'));
    });
  }
}

test('real doctor CLI emits parseable JSON and useful human output with an explicit npm CLI', async (t) => {
  const { root, npmCli } = await fixture(t);
  const result = cli(doctorScript, root, ['--json', '--npm-cli', npmCli]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.npmCli.path, npmCli);
  const human = cli(doctorScript, root, ['--npm-cli', npmCli]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /PASS.*node/i);
  assert.match(human.stdout, /N-API/);
  assert.match(human.stdout, /not required/i);
});

test('real doctor CLI returns exit 1 for missing prerequisites, including absent direct npm resolution', async (t) => {
  const { root, npmCli } = await fixture(t);
  const direct = cli(doctorScript, root, ['--json']);
  assert.equal(direct.status, 1, direct.stderr);
  assert.equal(check(JSON.parse(direct.stdout), 'npm').status, 'fail');
  await rm(join(root, 'package-lock.json'));
  const missingLock = cli(doctorScript, root, ['--json', '--npm-cli', npmCli]);
  assert.equal(missingLock.status, 1, missingLock.stderr);
  assert.equal(check(JSON.parse(missingLock.stdout), 'lockfile').status, 'fail');
});

test('npm_execpath from an npm-script invocation is used by the real CLI', async (t) => {
  const { root, npmCli } = await fixture(t);
  const result = spawnSync(process.execPath, [doctorScript, '--json'], {
    cwd: root,
    env: { ...process.env, HOME: root, USERPROFILE: root, npm_execpath: npmCli },
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
    shell: false,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).npmCli.source, 'npm_execpath');
});

for (const script of [doctorScript, setupScript]) {
  test(`${script} --help is side-effect free and describes the direct invocation contract`, async (t) => {
    const { root } = await fixture(t);
    await rm(join(root, 'package.json'));
    const result = cli(script, root, ['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--npm-cli/);
    assert.match(result.stdout, /npm_execpath/);
  });
  for (const args of [
    ['--unknown'],
    ['--npm-cli'],
    ['--npm-cli', '--json'],
    ['--npm-cli', 'one', '--npm-cli', 'two'],
    ['--help', '--unknown'],
  ]) {
    test(`${script} rejects invalid arguments ${args.join(' ')} before execution`, async (t) => {
      const { root } = await fixture(t);
      const result = cli(script, root, args);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /Usage:/);
    });
  }
}

test('doctor help explains how to suppress npm banners for machine-readable JSON', async (t) => {
  const { root } = await fixture(t);
  const result = cli(doctorScript, root, ['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npm --silent run doctor -- --json/);
});

test('importing onboarding functions from Node stdin performs no command or setup work', async (t) => {
  const { root } = await fixture(t);
  const modules = ['doctor.mjs', 'setup.mjs'].map(
    (name) => new URL(`../scripts/${name}`, import.meta.url).href,
  );
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    cwd: root,
    input: `${modules.map((url) => `await import(${JSON.stringify(url)});`).join('\n')}\nconsole.log('import-only');`,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
    shell: false,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'import-only');
});

test('doctor rejects duplicate --json and setup rejects unsupported --json', async (t) => {
  const { root } = await fixture(t);
  assert.equal(cli(doctorScript, root, ['--json', '--json']).status, 2);
  assert.equal(cli(setupScript, root, ['--json']).status, 2);
});

for (const failingStep of ['', 'ci', 'run']) {
  test(`real setup CLI exercises external command boundaries (${failingStep || 'success'})`, async (t) => {
    const { root, npmCli } = await fixture(t);
    const log = join(root, 'npm-commands.jsonl');
    const result = cli(setupScript, root, ['--npm-cli', npmCli], {
      FIXTURE_NPM_LOG: log,
      FIXTURE_NPM_FAIL: failingStep,
    });
    assert.equal(result.status, failingStep ? 7 : 0, result.stderr || result.stdout);
    const commands = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(commands[0][0], 'ci');
    assert.equal(commands.length, failingStep === 'ci' ? 1 : 2);
    if (commands.length === 2) assert.deepEqual(commands[1], ['run', 'check']);
  });
}

test('editor tasks use current npm scripts without auto-running or installing hooks', async () => {
  const readJson = async (name) =>
    JSON.parse(await readFile(join(repository, '.vscode', name), 'utf8'));
  const manifest = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
  const { tasks } = await readJson('tasks.json');
  for (const task of tasks) {
    assert.equal(task.type, 'npm');
    assert.ok(Object.hasOwn(manifest.scripts, task.script), `Unknown script ${task.script}`);
    assert.equal(task.options.cwd, '${workspaceFolder}');
    assert.notEqual(task.runOptions?.runOn, 'folderOpen');
    assert.ok(!['hooks:install', 'format', 'dev', 'pack', 'release'].includes(task.script));
  }
  for (const script of ['doctor', 'setup', 'check', 'typecheck', 'test', 'build']) {
    assert.ok(tasks.some((task) => task.script === script));
  }
  const settings = await readJson('settings.json');
  assert.equal(settings['editor.formatOnSave'], false);
  assert.equal(settings['prettier.requireConfig'], true);
  assert.equal(settings['typescript.tsdk'], 'node_modules/typescript/lib');
  const { recommendations } = await readJson('extensions.json');
  assert.ok(recommendations.includes('dbaeumer.vscode-eslint'));
  assert.ok(recommendations.includes('esbenp.prettier-vscode'));
});

test('dev container pins Node and isolates Linux dependencies/output without GUI or credential mounts', async () => {
  const root = join(repository, '.devcontainer');
  const config = JSON.parse(await readFile(join(root, 'devcontainer.json'), 'utf8'));
  const dockerfile = await readFile(join(root, 'Dockerfile'), 'utf8');
  const pin = (await readFile(join(repository, '.node-version'), 'utf8')).trim();
  assert.ok(dockerfile.includes(`FROM node:${pin}-bookworm-slim`));
  assert.match(dockerfile, /^FROM node:.*@sha256:[a-f0-9]{64}$/m);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /ELECTRON_SKIP_BINARY_DOWNLOAD=1/);
  assert.match(dockerfile, /ca-certificates git/);
  assert.doesNotMatch(dockerfile, /\bCOPY\b|\bADD\b|build-essential|xvfb/);
  assert.equal(config.build.context, '.');
  assert.equal(config.remoteUser, 'node');
  assert.equal(config.postCreateCommand, 'npm run setup');
  assert.match(config.name, /non-GUI/i);
  assert.equal(config.mounts.length, 3);
  for (const folder of ['node_modules', 'out', 'reports']) {
    assert.ok(config.mounts.includes(`type=volume,target=/workspaces/parallel-agents/${folder}`));
  }
  assert.doesNotMatch(
    JSON.stringify(config),
    /localEnv|\.ssh|\.aws|\.azure|\.claude|\.copilot|--privileged/,
  );
  assert.equal(config.forwardPorts, undefined);
});
