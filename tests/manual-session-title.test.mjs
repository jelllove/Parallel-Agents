import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { PreferencesStore } from '../src/main/preferences-store.ts';
import { draftSessionRows } from '../src/shared/managed-session.ts';
import { applySessionNames } from '../src/shared/session-presentation.ts';

test('initial manual names persist without overwriting later explicit renames', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pa-manual-name-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'prefs.json');
  const store = new PreferencesStore(path);
  await store.setInitialSessionName('claude', 'one', '  用户填写的标题  ', () => true);
  assert.equal(
    (await new PreferencesStore(path).read()).sessionNames['claude:one'],
    '用户填写的标题',
  );
  await store.renameSession('claude', 'one', 'Later manual name');
  await store.setInitialSessionName('claude', 'one', 'Old draft', () => true);
  assert.equal((await store.read()).sessionNames['claude:one'], 'Later manual name');
  await store.setInitialSessionName('claude', 'closed', 'Closed draft', () => false);
  assert.equal((await store.read()).sessionNames['claude:closed'], undefined);
});
test('legacy generated names stay inert and survive preference updates', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pa-legacy-name-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'prefs.json');
  const legacy = {
    sessionNames: {},
    projects: [],
    fontSize: 14,
    generatedTitles: {
      'claude:old': { attempt: 'old', status: 'complete', title: 'Saved generated name' },
      'claude:pending': { attempt: 'old', status: 'pending' },
    },
  };
  const bytes = JSON.stringify(legacy);
  await writeFile(path, bytes);
  const store = new PreferencesStore(path);
  const saved = await store.read();
  assert.equal(await readFile(path, 'utf8'), bytes);
  assert.equal(
    applySessionNames(
      [{ agent: 'claude', id: 'old', title: 'Native' }],
      saved.sessionNames,
      saved.generatedTitles,
    )[0].title,
    'Saved generated name',
  );
  await store.setFontSize(18);
  assert.deepEqual((await store.read()).generatedTitles, legacy.generatedTitles);
  assert.equal(typeof store.beginSessionTitle, 'undefined');
  assert.equal(typeof store.finishSessionTitle, 'undefined');
});
test('separate new tabs show their own required names before native identity exists', () => {
  const project = { id: 'claude:repo', agent: 'claude' };
  const tabs = {
    openTabs: ['one', 'two'],
    tabProjectId: { one: project.id, two: project.id },
    tabAgent: { one: 'claude', two: 'claude' },
    tabSessionId: {},
    managedTabs: {
      one: { launchId: 'one', createdAt: 1, sessionTitle: 'First task' },
      two: { launchId: 'two', createdAt: 2, sessionTitle: 'Second task' },
    },
  };
  assert.deepEqual(
    draftSessionRows([project], tabs).map((row) => row.title),
    ['First task', 'Second task'],
  );
});
