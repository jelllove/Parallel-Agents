import assert from 'node:assert/strict';
import test from 'node:test';
import {
  useActivityStore,
  subscribeActivity,
  sessionActivity,
} from '../src/renderer/store/activity-store.ts';

test('completion attention is acknowledged once and re-arms only for a later turn', (t) => {
  useActivityStore.setState(useActivityStore.getInitialState(), true);
  t.after(() => useActivityStore.setState(useActivityStore.getInitialState(), true));
  const record = {
    terminalKey: 'tab::agent',
    sessionId: 'one',
    agent: 'claude',
    generation: 'launch-one',
    revision: 1,
    state: 'completed',
  };
  const store = useActivityStore.getState();
  assert.equal(typeof store.accept, 'function');
  store.accept({ revision: 1, records: [record] });
  const first = useActivityStore.getState().completions[record.terminalKey];
  assert.equal(first.acknowledged, false);
  store.acknowledge(first.token);
  assert.equal(useActivityStore.getState().completions[record.terminalKey].acknowledged, true);
  store.accept({ revision: 2, records: [{ ...record, revision: 2 }] });
  assert.equal(useActivityStore.getState().completions[record.terminalKey].token, first.token);
  assert.equal(useActivityStore.getState().completions[record.terminalKey].acknowledged, true);
  store.accept({ revision: 3, records: [{ ...record, state: 'running', revision: 3 }] });
  assert.equal(useActivityStore.getState().completions[record.terminalKey], undefined);
  store.accept({ revision: 4, records: [{ ...record, revision: 4 }] });
  const second = useActivityStore.getState().completions[record.terminalKey];
  assert.notEqual(second.token, first.token);
  store.acknowledge(first.token);
  assert.equal(useActivityStore.getState().completions[record.terminalKey].acknowledged, false);
  store.accept({ revision: 5, records: [{ ...record, revision: 5, generation: 'replacement' }] });
  assert.notEqual(useActivityStore.getState().completions[record.terminalKey].token, second.token);
  store.accept({ revision: 6, records: [] });
  assert.deepEqual(useActivityStore.getState().completions, {});
});

test('activity requires linked open native identity and stale snapshot cannot overwrite live events', async (t) => {
  const initial = Promise.withResolvers();
  let listener;
  const previous = globalThis.window;
  globalThis.window = {
    api: {
      activity: {
        snapshot: () => initial.promise,
        onChange: (callback) => {
          listener = callback;
          return () => {};
        },
      },
    },
  };
  t.after(() => {
    globalThis.window = previous;
    useActivityStore.setState(useActivityStore.getInitialState(), true);
  });
  const off = subscribeActivity();
  const record = {
    terminalKey: 'tab::agent',
    sessionId: 'one',
    agent: 'claude',
    revision: 2,
    state: 'waiting',
    generation: 'g',
  };
  listener({ revision: 2, records: [record] });
  initial.resolve({ revision: 1, records: [] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(useActivityStore.getState().records[0].state, 'waiting');
  const tabs = { openTabs: ['tab'], tabAgent: { tab: 'claude' }, tabSessionId: { tab: 'one' } };
  assert.equal(sessionActivity([record], 'claude', 'one', tabs), 'waiting');
  assert.equal(sessionActivity([record], 'copilot', 'one', tabs), 'unknown');
  assert.equal(
    sessionActivity([record], 'claude', 'one', { ...tabs, tabSessionId: { tab: null } }),
    'unknown',
  );
  assert.equal(sessionActivity([record], 'claude', 'one', { ...tabs, openTabs: [] }), 'unknown');
  off();
});
