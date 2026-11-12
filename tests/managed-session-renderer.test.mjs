import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import test from 'node:test';

test('late managed identity reads cannot restore deleted session history', async () => {
  const pending = Promise.withResolvers();
  let revision = 0;
  let timer;
  const state = {
    managedTabs: { tab: { launchId: 'launch', sessionTitle: 'Chosen title' } },
    openTabs: ['tab'],
    tabProjectId: { tab: 'claude:repo' },
    tabSessionId: { tab: null },
    tabAgent: { tab: 'claude' },
    tabSessionBaseline: { tab: [] },
    sessions: {},
    loadSessions: async () => {},
  };
  const store = { getState: () => state, setState: (next) => Object.assign(state, next) };
  const source = await readFile(
    new URL('../src/renderer/store/managed-sessions.ts', import.meta.url),
    'utf8',
  );
  const { code } = await transform(source, { loader: 'ts', format: 'cjs' });
  const module = { exports: {} };
  const require = createRequire(import.meta.url);
  new Function('require', 'module', 'exports', 'window', 'document', code)(
    (id) => {
      if (id === './app-store.ts')
        return { useAppStore: store, sessionHistoryRevision: () => revision };
      if (id === './history-refresh-queue.ts')
        return require('../src/renderer/store/history-refresh-queue.ts');
      if (id === './activity-store.ts') return { useActivityStore: { subscribe: () => () => {} } };
      if (id === '../../shared/session-terminals.ts')
        return { agentTerminalKey: (id) => `${id}::agent` };
      return require(id);
    },
    module,
    module.exports,
    {
      api: { sessions: { inspectManaged: () => pending.promise } },
      setInterval: (callback) => {
        timer = callback;
        return 1;
      },
      clearInterval: () => {},
    },
    { hidden: false, addEventListener() {}, removeEventListener() {} },
  );
  const off = module.exports.subscribeManagedSessions();
  revision++;
  pending.resolve({ session: { id: 'deleted', agent: 'claude', projectId: 'claude:repo' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.tabSessionId.tab, null);
  assert.deepEqual(state.sessions, {});
  assert.equal(typeof timer, 'function');
  off();
});
