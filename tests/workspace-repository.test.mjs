import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { inspectWorkspaceRepository } from '../src/main/workspace-repository.ts';
const exec = promisify(execFile);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pa-repo-picker-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const git = (...args) =>
    exec('git', [
      '-C',
      root,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      `core.hooksPath=${join(root, 'no-hooks')}`,
      ...args,
    ]);
  await git('init', '-b', 'main');
  return { root, git };
}
test('real refs use full identities and preferred branch ordering without checkout or fetch', async (t) => {
  const f = await fixture(t);
  await f.git('commit', '--allow-empty', '-m', 'Fixture');
  for (const branch of ['z-task', 'develop', 'master']) await f.git('branch', branch);
  await f.git('tag', 'main');
  await f.git('update-ref', 'refs/remotes/origin/feature', 'HEAD');
  const info = await inspectWorkspaceRepository(f.root);
  assert.equal(info.hasHead, true);
  assert.equal(info.defaultRef, 'refs/heads/main');
  assert.deepEqual(
    info.refs.slice(0, 3).map((ref) => ref.value),
    ['refs/heads/main', 'refs/heads/master', 'refs/heads/develop'],
  );
  assert.ok(info.refs.some((ref) => ref.value === 'refs/tags/main' && ref.kind === 'tag'));
  assert.ok(info.refs.some((ref) => ref.value === 'refs/remotes/origin/feature'));
  assert.equal((await f.git('branch', '--show-current')).stdout.trim(), 'main');
});
test('missing preferred branches use HEAD and detached commits stay valid', async (t) => {
  const f = await fixture(t);
  await f.git('commit', '--allow-empty', '-m', 'Fixture');
  await f.git('branch', '-m', 'custom');
  assert.equal((await inspectWorkspaceRepository(f.root)).defaultRef, 'HEAD');
  await f.git('checkout', '--detach');
  const detached = await inspectWorkspaceRepository(f.root);
  assert.equal(detached.currentBranch, null);
  assert.equal(detached.hasHead, true);
  assert.equal(detached.defaultRef, 'HEAD');
});
test('ordinary folders and unborn repositories expose no false worktree readiness', async (t) => {
  const f = await fixture(t);
  const info = await inspectWorkspaceRepository(f.root);
  assert.equal(info.hasHead, false);
  const ordinary = join(f.root, 'ordinary');
  await mkdir(ordinary);
  const outside = await mkdtemp(join(tmpdir(), 'pa-plain-folder-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const plain = await inspectWorkspaceRepository(outside);
  assert.equal(plain.isGit, false);
  assert.equal(plain.exists, true);
  await assert.rejects(inspectWorkspaceRepository('relative'), /absolute/i);
});
