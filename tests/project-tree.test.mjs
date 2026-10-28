import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { promisify } from 'node:util';
import * as worktrees from '../src/main/worktrees.ts';

const exec = promisify(execFile);

test('worktree metadata groups existing and nested worktrees by the main repository', async (t) => {
  assert.equal(typeof worktrees.addProjectWorktreeMetadata, 'function');
  const fixture = await mkdtemp(join(tmpdir(), 'project-tree-'));
  t.after(() => rm(fixture, { recursive: true, force: true, maxRetries: 5 }));
  const root = join(fixture, 'main repo');
  const child = join(fixture, 'arbitrary child');
  const grandchild = join(fixture, 'another checkout');
  const git = (path, ...args) => exec('git', ['-C', path, ...args]);
  await mkdir(root);
  await git(root, 'init', '-b', 'main');
  await git(root, 'config', 'user.name', 'Fixture');
  await git(root, 'config', 'user.email', 'fixture@example.invalid');
  await git(root, 'config', 'commit.gpgSign', 'false');
  await git(root, 'config', 'core.hooksPath', join(fixture, 'no-hooks'));
  await writeFile(join(root, 'file.txt'), 'fixture\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'Fixture');
  await git(root, 'worktree', 'add', '-b', 'feature/one', child);
  await git(child, 'worktree', 'add', '--detach', grandchild);
  const plain = join(fixture, 'ordinary folder');
  await mkdir(plain);
  const rootAlias = join(fixture, 'main alias');
  await symlink(root, rootAlias, process.platform === 'win32' ? 'junction' : 'dir');
  const projects = [rootAlias, child, grandchild, plain, join(fixture, 'missing')].map(
    (realPath, i) => ({ id: String(i), realPath, exists: i !== 4 }),
  );
  const actual = await worktrees.addProjectWorktreeMetadata(projects);
  assert.equal(actual[0].worktree, undefined);
  assert.deepEqual(actual[1].worktree, {
    parentPath: rootAlias,
    branch: 'feature/one',
  });
  assert.deepEqual(actual[2].worktree, {
    parentPath: rootAlias,
    branch: null,
  });
  assert.equal(actual[3].worktree, undefined);
  assert.equal(actual[4].worktree, undefined);
  assert.deepEqual(
    actual.map((p) => p.id),
    projects.map((p) => p.id),
  );
  assert.equal(projects[1].worktree, undefined, 'input inventory is not mutated');
});
