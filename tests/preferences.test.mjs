import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PreferencesStore } from '../src/main/preferences-store.ts';

test('names, font settings and registered projects persist without losing concurrent writes', async (t) => {
  const dir = await mkdtemp(join(process.cwd(), '.pa-preferences-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'preferences.json');
  const store = new PreferencesStore(path);
  assert.equal((await store.read()).fontSize, 14);
  assert.equal((await store.read()).fontFamily, 'default');
  assert.equal((await store.read()).fontBold, false);
  await Promise.all([
    store.renameSession('codex', 'same-id', '  Fix login  '),
    store.renameSession('copilot', 'same-id', 'Review API'),
    store.setFontSize(18),
    store.setFontFamily('consolas'),
    store.setFontBold(true),
    store.registerProject({ id: 'codex:manual:test', agent: 'codex', realPath: dir }),
  ]);
  const reopened = new PreferencesStore(path);
  const data = await reopened.read();
  assert.equal(data.sessionNames['codex:same-id'], 'Fix login');
  assert.equal(data.sessionNames['copilot:same-id'], 'Review API');
  assert.equal(data.fontSize, 18);
  assert.equal(data.fontFamily, 'consolas');
  assert.equal(data.fontBold, true);
  assert.equal(data.projects[0].realPath, dir);
  await assert.rejects(store.renameSession('codex', 'same-id', '  '), /name/i);
  await assert.rejects(store.setFontSize(50), /font/i);
  await store.forgetProject('codex:manual:test');
  assert.equal((await store.read()).projects.length, 0);
  await store.setFontBold(false);
  assert.equal((await new PreferencesStore(path).read()).fontBold, false);
});

test('invalid stored JSON surfaces an error instead of overwriting preferences', async (t) => {
  const dir = await mkdtemp(join(process.cwd(), '.pa-preferences-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'preferences.json');
  await writeFile(path, '{broken');
  await assert.rejects(new PreferencesStore(path).setFontSize(16), SyntaxError);
});

test('invalid registered projects reject without poisoning later writes', async (t) => {
  const dir = await mkdtemp(join(process.cwd(), '.pa-preferences-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'preferences.json');
  const store = new PreferencesStore(path);
  const valid = {
    sessionNames: {},
    fontSize: 14,
    fontBold: false,
    projects: [{ id: 'codex:manual:test', agent: 'codex', realPath: dir }],
  };
  await writeFile(path, JSON.stringify({ ...valid, projects: [null] }));
  await assert.rejects(store.read(), /registered project/i);
  await assert.rejects(store.setFontSize(16), /registered project/i);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).projects, [null]);

  for (const project of [
    {},
    { id: '', agent: 'codex', realPath: dir },
    { id: 'bad-agent', agent: 'unknown', realPath: dir },
    { id: 'bad-path', agent: 'codex', realPath: '' },
    { id: 'bad-history', agent: 'codex', realPath: dir, historyPath: 1 },
  ]) {
    assert.throws(() => store.registerProject(project), /registered project/i);
  }

  await writeFile(path, JSON.stringify(valid));
  const recovered = new PreferencesStore(path);
  await recovered.registerProject({ id: 'copilot:manual:test', agent: 'copilot', realPath: dir });
  assert.equal((await recovered.read()).projects.length, 2);
});

test('legacy preferences default typography options and preserve existing settings when migrated', async (t) => {
  const dir = await mkdtemp(join(process.cwd(), '.pa-preferences-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'preferences.json');
  const legacy = { sessionNames: { 'codex:session': 'Existing name' }, fontSize: 20, projects: [] };
  await writeFile(path, JSON.stringify(legacy));
  const store = new PreferencesStore(path);
  const defaults = {
    fontFamily: 'default',
    fontBold: false,
    recentFolders: [],
    openTabs: { tabs: [], activeIndex: -1 },
    sortOrders: { projects: 'created', sessions: 'created', explorer: 'created' },
  };
  assert.deepEqual(await store.read(), { ...legacy, ...defaults });
  await store.setFontSize(21);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
    ...legacy,
    fontSize: 21,
    ...defaults,
  });
});

test('invalid font families reject without overwriting preferences or poisoning later writes', async (t) => {
  const dir = await mkdtemp(join(process.cwd(), '.pa-preferences-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'preferences.json');
  const store = new PreferencesStore(path);
  await store.setFontFamily('cascadia-mono');
  const original = await readFile(path, 'utf8');
  for (const invalid of [undefined, null, '', 'Comic Sans MS', 0, [], {}]) {
    await assert.rejects(store.setFontFamily(invalid), /font family/i);
    assert.equal(await readFile(path, 'utf8'), original);
  }
  for (const invalid of [null, '', 'Comic Sans MS', 0, [], {}]) {
    const text = JSON.stringify({
      sessionNames: {},
      fontSize: 14,
      fontFamily: invalid,
      projects: [],
      fontBold: false,
    });
    await writeFile(path, text);
    await assert.rejects(store.read(), /font family/i);
    await assert.rejects(store.setFontSize(18), /font family/i);
    await assert.rejects(store.setFontFamily('default'), /font family/i);
    assert.equal(await readFile(path, 'utf8'), text);
  }
  await writeFile(path, original);
  await store.setFontFamily('monospace');
  assert.equal((await store.read()).fontFamily, 'monospace');
});

test('invalid bold values reject without overwriting preferences or poisoning later writes', async (t) => {
  const dir = await mkdtemp(join(process.cwd(), '.pa-preferences-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'preferences.json');
  const store = new PreferencesStore(path);
  await store.setFontBold(true);
  const original = await readFile(path, 'utf8');
  for (const invalid of [undefined, null, 0, 1, 'true', 'false', [], {}]) {
    await assert.rejects(store.setFontBold(invalid), /font bold.*boolean/i);
    assert.equal(await readFile(path, 'utf8'), original);
  }
  for (const invalid of [null, 0, 1, 'true', 'false', [], {}]) {
    const text = JSON.stringify({
      sessionNames: {},
      fontSize: 14,
      fontFamily: 'default',
      projects: [],
      fontBold: invalid,
    });
    await writeFile(path, text);
    await assert.rejects(store.read(), /font bold.*boolean/i);
    await assert.rejects(store.setFontSize(18), /font bold.*boolean/i);
    await assert.rejects(store.setFontBold(false), /font bold.*boolean/i);
    assert.equal(await readFile(path, 'utf8'), text);
  }
  await writeFile(path, original);
  await store.setFontBold(false);
  assert.equal((await store.read()).fontBold, false);
});

test('recent folders stay unique, newest first and capped at 18', async (t) => {
  const dir = await mkdtemp(join(process.cwd(), '.pa-preferences-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new PreferencesStore(join(dir, 'preferences.json'));
  assert.deepEqual((await store.read()).recentFolders, []);
  for (let i = 0; i < 20; i++) await store.addRecentFolder(`C:\\work\\p${i}`);
  await store.addRecentFolder('c:\\WORK\\p5');
  const recent = (await store.read()).recentFolders;
  assert.equal(recent.length, 18);
  assert.equal(recent[0], 'c:\\WORK\\p5');
  assert.equal(recent.filter((p) => p.toLowerCase() === 'c:\\work\\p5').length, 1);
  assert.equal(recent[1], 'C:\\work\\p19');
  await assert.rejects(store.addRecentFolder(''), /folder/i);
});

test('open tabs round-trip and invalid entries are rejected', async (t) => {
  const dir = await mkdtemp(join(process.cwd(), '.pa-preferences-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new PreferencesStore(join(dir, 'preferences.json'));
  assert.deepEqual((await store.read()).openTabs, { tabs: [], activeIndex: -1 });
  const saved = {
    tabs: [
      { projectId: 'claude:C--repo', agent: 'claude', sessionId: 'abc' },
      { projectId: 'copilot:C:\\repo', agent: 'copilot', sessionId: null },
    ],
    activeIndex: 1,
  };
  await store.setOpenTabs(saved);
  assert.deepEqual(
    (await new PreferencesStore(join(dir, 'preferences.json')).read()).openTabs,
    saved,
  );
  assert.throws(
    () => store.setOpenTabs({ tabs: [{ projectId: '', agent: 'claude' }], activeIndex: 0 }),
    /open tabs/i,
  );
  assert.throws(() => store.setOpenTabs({ tabs: [], activeIndex: 3 }), /open tabs/i);
});

test('a transiently locked preferences file is retried instead of failing the write', async (t) => {
  const { rename } = await import('node:fs/promises');
  const dir = await mkdtemp(join(process.cwd(), '.pa-preferences-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'preferences.json');
  let failures = 0;
  const flaky = async (from, to) => {
    if (failures < 2) {
      failures++;
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    }
    return rename(from, to);
  };
  const store = new PreferencesStore(path, flaky);
  await store.setFontSize(16);
  assert.equal(failures, 2);
  assert.equal((await new PreferencesStore(path).read()).fontSize, 16);

  const locked = new PreferencesStore(path, async () => {
    throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
  });
  await assert.rejects(locked.setFontSize(18), /EPERM|not permitted/);
  assert.equal((await new PreferencesStore(path).read()).fontSize, 16);
});

test('sort orders default to date created per panel and persist independently', async (t) => {
  const dir = await mkdtemp(join(process.cwd(), '.pa-preferences-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'preferences.json');
  const store = new PreferencesStore(path);
  assert.deepEqual((await store.read()).sortOrders, {
    projects: 'created',
    sessions: 'created',
    explorer: 'created',
  });
  await store.setSortOrder('sessions', 'name');
  await store.setSortOrder('explorer', 'modified');
  assert.deepEqual((await new PreferencesStore(path).read()).sortOrders, {
    projects: 'created',
    sessions: 'name',
    explorer: 'modified',
  });
  await assert.rejects(store.setSortOrder('sessions', 'bogus'), /sort order/i);
  await assert.rejects(store.setSortOrder('tabs', 'name'), /sort panel/i);
});
