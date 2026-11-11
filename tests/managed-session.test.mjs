import assert from 'node:assert/strict';
import test from 'node:test';
import { draftSessionRows } from '../src/shared/managed-session.ts';

test('draft rows have tab identities before native history and disappear only after exact binding', () => {
  const project = { id: 'claude:repo', agent: 'claude' };
  const state = {
    openTabs: ['one', 'two'],
    tabProjectId: { one: project.id, two: project.id },
    tabAgent: { one: 'claude', two: 'claude' },
    tabSessionId: { one: null, two: null },
    managedTabs: { one: { createdAt: 1 }, two: { createdAt: 2 } },
  };
  assert.deepEqual(
    draftSessionRows([project], state).map((row) => row.tabId),
    ['one', 'two'],
  );
  state.tabSessionId.two = 'native-two';
  assert.deepEqual(
    draftSessionRows([project], state).map((row) => row.tabId),
    ['one'],
  );
  state.openTabs = [];
  assert.deepEqual(draftSessionRows([project], state), []);
});
