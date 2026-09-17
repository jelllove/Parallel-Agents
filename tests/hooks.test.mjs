import './helpers/isolated-git.mjs';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installer = join(repoRoot, 'scripts', 'install-hooks.mjs');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'parallel-agents-hooks-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const globalConfig = join(root, 'global.gitconfig');
  await writeFile(globalConfig, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) =>
    execFileAsync(
      'git',
      [
        '-c',
        'user.name=Hook Test',
        '-c',
        'user.email=hook@example.invalid',
        '-c',
        'commit.gpgSign=false',
        '-C',
        root,
        ...args,
      ],
      { env, windowsHide: true },
    );
  await git('init', '--initial-branch=main');
  await mkdir(join(root, '.githooks'));
  await copyFile(join(repoRoot, '.githooks', 'pre-commit'), join(root, '.githooks', 'pre-commit'));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'hook-fixture',
      version: '1.0.0',
      scripts: { check: 'node validation.mjs' },
    }),
  );
  await writeFile(
    join(root, 'validation.mjs'),
    'process.exit(Number(process.env.FAIL_HOOK ?? 0));\n',
  );
  const run = (...args) =>
    execFileAsync(process.execPath, [installer, ...args], { cwd: root, env });
  return { root, env, git, run, globalConfig };
}

test('hook setup defaults to a non-mutating preview and explicitly describes shared scope', async (t) => {
  const { run, git } = await fixture(t);
  const result = await run();
  assert.match(result.stdout, /--apply/);
  assert.match(result.stdout, /worktree|shared/i);
  await assert.rejects(
    git('config', '--local', '--get', 'core.hooksPath'),
    (error) => error.code === 1,
  );
});

test('explicit hook installation is idempotent and check mode confirms it', async (t) => {
  const { root, run, git } = await fixture(t);
  await assert.rejects(run('--check'), (error) => error.code === 1);
  await run('--apply');
  await run('--apply');
  await run('--check');
  assert.equal(
    await realpath((await git('config', '--local', '--get', 'core.hooksPath')).stdout.trim()),
    await realpath(join(root, '.githooks')),
  );
});

test('existing default hooks are never replaced or bypassed', async (t) => {
  const { root, run, git } = await fixture(t);
  const hook = join(root, '.git', 'hooks', 'pre-commit');
  await writeFile(hook, '#!/bin/sh\nexit 0\n');
  await assert.rejects(run('--apply'), /existing.*hook/i);
  assert.equal(await readFile(hook, 'utf8'), '#!/bin/sh\nexit 0\n');
  await assert.rejects(
    git('config', '--local', '--get', 'core.hooksPath'),
    (error) => error.code === 1,
  );
});

for (const name of ['commit-msg', 'pre-push', 'reference-transaction']) {
  test(`installing validation does not bypass an existing ${name} policy`, async (t) => {
    const { root, run, git } = await fixture(t);
    const hook = join(root, '.git', 'hooks', name);
    await writeFile(hook, '#!/bin/sh\nexit 0\n');
    await assert.rejects(run('--apply'), /existing.*hook/i);
    assert.equal(await readFile(hook, 'utf8'), '#!/bin/sh\nexit 0\n');
    await assert.rejects(
      git('config', '--local', '--get', 'core.hooksPath'),
      (error) => error.code === 1,
    );
  });
}

test('inherited hook policies are not overridden by a repository-local setting', async (t) => {
  const { root, run, git, globalConfig } = await fixture(t);
  await git('config', '--file', globalConfig, 'core.hooksPath', join(root, 'corporate-hooks'));
  await assert.rejects(run('--apply'), /existing.*hook/i);
  await assert.rejects(
    git('config', '--local', '--get', 'core.hooksPath'),
    (error) => error.code === 1,
  );
});

test('hook installation rejects linked hook directories', async (t) => {
  const { root, run } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'parallel-agents-hook-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await rm(join(root, '.githooks'), { recursive: true, force: true });
  await symlink(
    outside,
    join(root, '.githooks'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(run('--apply'), /link/i);
});

test('installed hooks really block failing validation and allow a passing fixture commit', async (t) => {
  const { root, run, git, env } = await fixture(t);
  await run('--apply');
  await git('add', 'package.json', 'validation.mjs', '.githooks/pre-commit');
  const args = [
    '-c',
    'user.name=Hook Test',
    '-c',
    'user.email=hook@example.invalid',
    '-c',
    'commit.gpgSign=false',
    '-C',
    root,
    'commit',
    '-m',
    'Fixture',
  ];
  await assert.rejects(
    execFileAsync('git', args, { env: { ...env, FAIL_HOOK: '1' }, windowsHide: true }),
    (error) => error.code !== 0,
  );
  await execFileAsync('git', args, { env: { ...env, FAIL_HOOK: '0' }, windowsHide: true });
  assert.match((await git('rev-parse', 'HEAD')).stdout.trim(), /^[a-f0-9]{40,64}$/);
});

test('hook validation cannot redirect temporary Git writes into an inherited caller index', async (t) => {
  const { root, run, git, env } = await fixture(t);
  await writeFile(
    join(root, 'validation.mjs'),
    `
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const temporary = mkdtempSync(join(tmpdir(), 'parallel-agents-hook-child-'));
try {
  execFileSync('git', ['-C', temporary, 'init', '--initial-branch=main']);
  writeFileSync(join(temporary, 'fixture-only.txt'), 'must stay in the fixture');
  execFileSync('git', ['-C', temporary, 'add', '--', 'fixture-only.txt']);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
`,
  );
  await git('add', 'package.json', 'validation.mjs');
  const before = (await git('ls-files', '--stage', '-z')).stdout;
  const index = resolve(root, (await git('rev-parse', '--git-path', 'index')).stdout.trim());
  await run('--apply');
  await execFileAsync('git', ['-C', root, 'hook', 'run', 'pre-commit'], {
    env: { ...env, GIT_INDEX_FILE: index },
    windowsHide: true,
  });
  assert.equal((await git('ls-files', '--stage', '-z')).stdout, before);
});
