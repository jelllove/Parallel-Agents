import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import test from 'node:test';
const require = createRequire(import.meta.url);
const flush = () => new Promise((resolve) => setImmediate(resolve));
test('linked history uses slower fallback and acknowledgement/running floods do not read disk', async () => {
  let tick, activity, visible;
  const calls = [];
  const state = {
    openTabs: ['tab'],
    managedTabs: { tab: { launchId: 'launch' } },
    tabSessionId: { tab: 'native' },
    tabProjectId: { tab: 'claude:repo' },
    tabAgent: { tab: 'claude' },
    loadSessions: async (id) => calls.push(id),
  };
  const store = { getState: () => state, setState: (next) => Object.assign(state, next) };
  const { code } = await transform(
    await readFile(new URL('../src/renderer/store/managed-sessions.ts', import.meta.url), 'utf8'),
    { loader: 'ts', format: 'cjs' },
  );
  const module = { exports: {} };
  const doc = {
    hidden: false,
    addEventListener: (_name, fn) => (visible = fn),
    removeEventListener() {},
  };
  new Function('require', 'module', 'exports', 'window', 'document', code)(
    (id) => {
      if (id === './app-store.ts') return { useAppStore: store, sessionHistoryRevision: () => 0 };
      if (id === './history-refresh-queue.ts')
        return require('../src/renderer/store/history-refresh-queue.ts');
      if (id === './activity-store.ts')
        return {
          useActivityStore: {
            subscribe: (fn) => {
              activity = fn;
              return () => {};
            },
          },
        };
      if (id === '../../shared/session-terminals.ts')
        return { agentTerminalKey: (id) => `${id}::agent` };
      return require(id);
    },
    module,
    module.exports,
    {
      setInterval: (fn) => {
        tick = fn;
        return 1;
      },
      clearInterval() {},
      api: {
        sessions: {
          inspectManaged: async () => {
            throw new Error('Already linked must not inspect');
          },
        },
      },
    },
    doc,
  );
  const off = module.exports.subscribeManagedSessions();
  await flush();
  assert.deepEqual(calls, []);
  for (let i = 0; i < 4; i++) tick();
  await flush();
  assert.deepEqual(calls, []);
  tick();
  await flush();
  assert.deepEqual(calls, ['claude:repo']);
  const record = {
    terminalKey: 'tab::agent',
    generation: 'one',
    sessionId: 'native',
    state: 'running',
  };
  const records = [record];
  activity({ records }, { records });
  activity({ records: [{ ...record, revision: 2 }] }, { records });
  await flush();
  assert.equal(calls.length, 1);
  activity({ records: [{ ...record, state: 'completed' }] }, { records });
  await flush();
  assert.equal(calls.length, 2);
  doc.hidden = true;
  for (let i = 0; i < 14; i++) tick();
  await flush();
  assert.equal(calls.length, 2);
  tick();
  await flush();
  assert.equal(calls.length, 3);
  doc.hidden = false;
  visible();
  await flush();
  assert.equal(calls.length, 4);
  off();
});
