import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PreferencesStore } from '../src/main/preferences-store.ts';

async function fixture(t, platform = process.platform) {
  const root = await mkdtemp(join(tmpdir(), 'pa-recent-folders-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'preferences.json');
  return { root, path, store: new PreferencesStore(path, platform) };
}

test('successful folders persist across restart and reopening moves them to the front without truncation', async (t) => {
  const { root, path, store } = await fixture(t);
  const folders = [];
  for (let i = 0; i < 35; i++) {
    const folder = join(root, `folder-${i}`);
    await mkdir(folder);
    folders.push(folder);
    await store.addRecentFolder(folder);
  }
  assert.equal((await store.read()).recentFolders.length, 35);
  await store.addRecentFolder(folders[0]);
  const history = (await new PreferencesStore(path).read()).recentFolders;
  assert.equal(history[0], folders[0]);
  assert.equal(history.length, 35);
  assert.equal(history.filter((path) => path === folders[0]).length, 1);
});

test('legacy registered folders populate history without changing other settings', async (t) => {
  const { root, path, store } = await fixture(t);
  const old = {
    sessionNames: { 'codex:one': 'Keep this' },
    fontSize: 18,
    fontFamily: 'consolas',
    fontBold: true,
    projects: [
      { id: 'a', realPath: root, agent: 'codex' },
      { id: 'b', realPath: root, agent: 'copilot' },
    ],
  };
  await writeFile(path, JSON.stringify(old));
  assert.deepEqual((await store.read()).recentFolders, [root]);
  assert.equal(
    await readFile(path, 'utf8'),
    JSON.stringify(old),
    'reading must not mutate legacy data',
  );
  await store.setFontSize(20);
  assert.deepEqual((await new PreferencesStore(path).read()).recentFolders, [root]);
  assert.deepEqual((await store.read()).sessionNames, old.sessionNames);
});

test('registration records folder/worktree paths atomically and forgetting a project retains history', async (t) => {
  const { root, path, store } = await fixture(t);
  const base = join(root, 'base');
  const worktree = join(root, 'branch');
  await mkdir(base);
  await mkdir(worktree);
  await Promise.all([
    store.registerProject({ id: 'p', realPath: worktree, agent: 'codex' }, [base]),
    store.setFontSize(19),
    store.addRecentFolder(base),
  ]);
  const data = await new PreferencesStore(path).read();
  assert.equal(data.projects[0].realPath, worktree);
  assert.equal(data.fontSize, 19);
  assert.deepEqual(new Set(data.recentFolders), new Set([base, worktree]));
  await store.forgetProject('p');
  assert.deepEqual(new Set((await store.read()).recentFolders), new Set([base, worktree]));
});

test('path identity is case-insensitive only on Windows and normalizes separators/trailing slashes', async (t) => {
  const win = await fixture(t, 'win32');
  await win.store.registerProject({ id: 'a', agent: 'codex', realPath: 'C:\\Repo\\' });
  await win.store.registerProject({ id: 'b', agent: 'copilot', realPath: 'c:/repo' });
  assert.equal((await win.store.read()).recentFolders.length, 1);
  const posix = await fixture(t, 'linux');
  await posix.store.registerProject({ id: 'a', agent: 'codex', realPath: '/Repo' });
  await posix.store.registerProject({ id: 'b', agent: 'copilot', realPath: '/repo' });
  assert.deepEqual((await posix.store.read()).recentFolders, ['/repo', '/Repo']);
});

test('invalid, missing and file paths never add history and later operations still work', async (t) => {
  const { root, store } = await fixture(t);
  await writeFile(join(root, 'not-directory'), 'fixture');
  for (const folder of [
    '',
    'relative',
    null,
    5,
    join(root, 'missing'),
    join(root, 'not-directory'),
  ]) {
    await assert.rejects(store.addRecentFolder(folder));
  }
  assert.deepEqual((await store.read()).recentFolders, []);
  await store.addRecentFolder(root);
  assert.equal((await store.read()).recentFolders.length, 1);
});

test('POSIX history preserves backslash characters in folder names', async (t) => {
  const { store } = await fixture(t, 'linux');
  await store.registerProject({ id: 'backslash', agent: 'codex', realPath: '/projects/repo\\' });
  assert.deepEqual((await store.read()).recentFolders, ['/projects/repo\\']);
});

test('malformed stored history is surfaced and never overwritten', async (t) => {
  const { root, path, store } = await fixture(t);
  for (const recentFolders of [null, 'bad', [5], ['relative'], ['']]) {
    const text = JSON.stringify({ sessionNames: {}, fontSize: 14, projects: [], recentFolders });
    await writeFile(path, text);
    await assert.rejects(store.read(), /recent folder/i);
    await assert.rejects(store.addRecentFolder(root), /recent folder/i);
    assert.equal(await readFile(path, 'utf8'), text);
  }
});
