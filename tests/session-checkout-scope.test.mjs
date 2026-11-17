import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import test from 'node:test';
import { resolveHistoryCheckoutScope } from '../src/main/session-checkout-scope.ts';
import { createProjectWorktree } from '../src/main/worktrees.ts';

const exec = promisify(execFile);
const encodedId = (path) => `claude:${path.replace(/[^a-zA-Z0-9]/g, '-')}`;
const registered = (path) => ({
  id: `claude:manual:${path}`,
  agent: 'claude',
  realPath: path,
  historyPath: path,
});
const canonicalKey = async (path) => {
  const value = await realpath(path);
  return process.platform === 'win32' ? value.toLowerCase() : value;
};

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(process.cwd(), 'reports', 'cleanup-scope-')));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const base = join(root, 'repo');
  await mkdir(base);
  const git = (...args) =>
    exec('git', [
      '-C',
      base,
      '-c',
      'user.name=Scope Fixture',
      '-c',
      'user.email=scope@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      `core.hooksPath=${join(root, 'disabled-hooks')}`,
      ...args,
    ]);
  await git('init', '-b', 'main');
  await git('commit', '--allow-empty', '-m', 'Scope fixture');
  const create = (name, branch) =>
    createProjectWorktree({
      basePath: base,
      targetPath: join(root, 'repo.worktrees', name),
      branch,
      startPoint: 'HEAD',
    });
  return { root, base, create };
}

test('registered encoded history scopes to its real linked checkout, not a decoded path under the primary repo', async (t) => {
  const f = await fixture(t);
  const target = await f.create('feat-20261113_adjust-the-ci-build-trigger', 'feat/target');
  const other = await f.create('feat-20261116_answer-the-question', 'feat/other');
  const registrations = [registered(target), registered(other)];
  assert.equal(
    await resolveHistoryCheckoutScope(encodedId(other), registrations),
    await canonicalKey(other),
  );
  assert.equal(
    await resolveHistoryCheckoutScope(registrations[0].id, registrations),
    await canonicalKey(target),
  );
  assert.equal(
    await resolveHistoryCheckoutScope(encodedId(other), [registered(target)]),
    undefined,
  );
  assert.equal(
    await resolveHistoryCheckoutScope(
      encodedId(other).replace(/^claude:/, 'copilot:'),
      registrations,
    ),
    undefined,
  );
});

test('lossy encoding collisions across real checkout roots never resolve ownership scope', async (t) => {
  const f = await fixture(t);
  const first = await f.create('feat-a', 'feat/first');
  const second = await f.create('feat_a', 'feat/second');
  assert.equal(encodedId(first), encodedId(second));
  assert.equal(
    await resolveHistoryCheckoutScope(encodedId(first), [registered(first), registered(second)]),
    undefined,
  );
  assert.equal(
    await resolveHistoryCheckoutScope(encodedId(first), [registered(first)]),
    undefined,
    'Git inventory must detect an unregistered colliding checkout',
  );
});

test('Git-scoped registrations use historyPath and reject missing, non-Git or broken metadata', async (t) => {
  const f = await fixture(t);
  const checkout = await f.create('linked', 'feat/linked');
  const sub = join(checkout, 'subfolder');
  await mkdir(sub);
  const alias = { ...registered(sub), historyPath: checkout };
  assert.equal(
    await resolveHistoryCheckoutScope(encodedId(checkout), [alias]),
    await canonicalKey(checkout),
  );
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'cleanup-no-repository-')));
  t.after(() => rm(outside, { recursive: true, force: true, maxRetries: 5 }));
  const ordinary = join(outside, 'ordinary');
  const broken = join(f.root, 'broken');
  await mkdir(ordinary);
  await mkdir(broken);
  await writeFile(join(broken, '.git'), 'gitdir: missing\n');
  for (const path of [ordinary, broken, join(f.root, 'missing')])
    assert.equal(await resolveHistoryCheckoutScope(encodedId(path), [registered(path)]), undefined);
});
