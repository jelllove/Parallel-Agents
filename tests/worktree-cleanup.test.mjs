import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm, stat, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createProjectWorktree,
  inspectLinkedWorktree,
  removeLinkedWorktree,
} from '../src/main/worktrees.ts';
import {
  eligibleRecentFolders,
  recordRecentFolder,
  readRecentFolders,
} from '../src/main/workspace-history.ts';
import { PreferencesStore } from '../src/main/preferences-store.ts';
import { guardCheckout } from '../src/main/checkout-guard.ts';
const exec = promisify(execFile);

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pa-cleanup-')));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const base = join(root, 'base');
  await mkdir(base);
  const git = (...args) =>
    exec('git', [
      '-C',
      base,
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
  await writeFile(join(base, '.gitignore'), 'ignored.txt\n');
  await git('add', '.gitignore');
  await git('commit', '-m', 'Fixture');
  const wt = await createProjectWorktree({
    basePath: base,
    targetPath: join(root, 'checkout'),
    branch: 'feat/cleanup',
    startPoint: 'HEAD',
  });
  return { root, base, wt, git, info: await inspectLinkedWorktree(wt) };
}

test('clean linked worktree removal preserves its branch and primary repository', async (t) => {
  const f = await fixture(t);
  assert.equal(await inspectLinkedWorktree(f.base), null);
  await removeLinkedWorktree(f.info);
  await assert.rejects(stat(f.wt), { code: 'ENOENT' });
  assert.ok((await stat(f.base)).isDirectory());
  assert.match((await f.git('branch', '--list', 'feat/cleanup')).stdout, /feat\/cleanup/);
});
for (const name of ['untracked.txt', 'ignored.txt', '.gitignore'])
  test(`worktree removal retains ${name} changes`, async (t) => {
    const f = await fixture(t);
    await writeFile(join(f.wt, name), 'Keep this data\n');
    await assert.rejects(removeLinkedWorktree(f.info), /uncommitted|untracked|ignored/i);
    assert.ok((await stat(f.wt)).isDirectory());
  });
test('primary checkout and replaced identities never authorize removal', async (t) => {
  const f = await fixture(t);
  await assert.rejects(removeLinkedWorktree({ ...f.info, root: f.base }), /identity changed/);
  await assert.rejects(
    removeLinkedWorktree({ ...f.info, identity: 'old-identity' }),
    /identity changed/,
  );
  assert.ok((await stat(f.base)).isDirectory());
  assert.ok((await stat(f.wt)).isDirectory());
});
test('a replaced symlink or junction cannot redirect worktree deletion', async (t) => {
  const f = await fixture(t);
  const alias = join(f.root, 'checkout-alias');
  await symlink(f.wt, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(removeLinkedWorktree({ ...f.info, root: alias }), /replaced by a link/);
  assert.ok((await stat(f.wt)).isDirectory());
});
test('locked checkout is retained without force unlocking', async (t) => {
  const f = await fixture(t);
  await f.git('worktree', 'lock', f.wt);
  await assert.rejects(removeLinkedWorktree(f.info), /locked/);
});
test('recent folders exclude linked checkouts and subdirectories without changing saved legacy data', async (t) => {
  const f = await fixture(t);
  const sub = join(f.wt, 'sub');
  await mkdir(sub);
  const ordinary = join(f.root, 'ordinary.worktrees');
  await mkdir(ordinary);
  assert.deepEqual(await eligibleRecentFolders([f.base, f.wt, sub, ordinary]), [f.base, ordinary]);
  const path = join(f.root, 'preferences.json');
  const store = new PreferencesStore(path);
  await store.addRecentFolder(f.wt);
  await recordRecentFolder(store, f.base);
  await recordRecentFolder(store, sub);
  assert.deepEqual(await readRecentFolders(store), [f.base]);
  assert.ok((await store.read()).recentFolders.includes(f.wt));
});
test('checkout guard blocks overlapping starts and releases after failure', async (t) => {
  const f = await fixture(t);
  const wait = Promise.withResolvers();
  const held = guardCheckout(f.wt, () => wait.promise);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    guardCheckout(f.wt, async () => {}),
    /busy/,
  );
  wait.resolve();
  await held;
  await guardCheckout(f.wt, async () => {});
  const shared = Promise.withResolvers();
  const first = guardCheckout(f.wt, () => shared.promise, false);
  await new Promise((resolve) => setImmediate(resolve));
  await guardCheckout(f.wt, async () => {}, false);
  await assert.rejects(
    guardCheckout(f.wt, async () => {}),
    /busy/,
  );
  shared.resolve();
  await first;
});
