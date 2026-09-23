import assert from 'node:assert/strict';
import test from 'node:test';

import { closeTabIds, omitRecordKeys, tabKeysForProject } from '../src/renderer/store/tab-state.ts';

test('closing other tabs keeps the target active', () => {
  assert.deepEqual(closeTabIds(['a', 'b', 'c'], 'a', ['a', 'c']), {
    openTabs: ['b'],
    activeTabId: 'b',
  });
});

test('closing all tabs clears the active tab', () => {
  assert.deepEqual(closeTabIds(['a', 'b'], 'b', ['a', 'b']), { openTabs: [], activeTabId: null });
});

test('closing an active tab selects its next neighbor', () => {
  assert.deepEqual(closeTabIds(['a', 'b', 'c'], 'b', ['b']), {
    openTabs: ['a', 'c'],
    activeTabId: 'c',
  });
});

test('closing tabs does not change an active tab that remains open', () => {
  assert.deepEqual(closeTabIds(['a', 'b', 'c'], 'b', ['a', 'c']), {
    openTabs: ['b'],
    activeTabId: 'b',
  });
});

test('removes closed tab keys from tab-specific state', () => {
  assert.deepEqual(omitRecordKeys({ a: 1, b: 2, c: 3 }, ['a', 'c']), { b: 2 });
});

test('returns all tab keys that belong to the same project', () => {
  const result = tabKeysForProject(
    {
      'copilot:C:\\repo': 'copilot:C:\\repo',
      'copilot:C:\\repo::session:a': 'copilot:C:\\repo',
      'copilot:C:\\other::session:b': 'copilot:C:\\other',
    },
    'copilot:C:\\repo',
  );

  assert.deepEqual(result, ['copilot:C:\\repo', 'copilot:C:\\repo::session:a']);
});

test('session snapshot keeps tab order, agents, sessions and the active tab', async () => {
  const { snapshotOpenTabs } = await import('../src/renderer/store/tab-state.ts');
  assert.deepEqual(
    snapshotOpenTabs({
      openTabs: ['a', 'b::s1', 'adhoc'],
      activeTabId: 'b::s1',
      tabProjectId: { a: 'claude:a', 'b::s1': 'codex:b', adhoc: 'adhoc:x' },
      tabAgent: { a: 'claude', 'b::s1': 'codex', adhoc: 'claude' },
      tabSessionId: { a: null, 'b::s1': 's1', adhoc: null },
    }),
    {
      tabs: [
        { projectId: 'claude:a', agent: 'claude', sessionId: null },
        { projectId: 'codex:b', agent: 'codex', sessionId: 's1' },
      ],
      activeIndex: 1,
    },
  );
});
