import assert from 'node:assert/strict';
import test from 'node:test';
import { useAppStore } from '../src/renderer/store/app-store.ts';
import { useBackgroundOperations } from '../src/renderer/store/background-operations.ts';
import {
  queueProjectCreation,
  queueProjectDeletion,
  queueSessionDeletion,
} from '../src/renderer/store/workspace-operations.ts';

import * as workspaceOperations from '../src/renderer/store/workspace-operations.ts';
const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup(t, api) {
  const previous = globalThis.window;
  globalThis.window = { api };
  useAppStore.setState(useAppStore.getInitialState(), true);
  useBackgroundOperations.setState({ operations: [] });
  t.after(() => {
    useAppStore.setState(useAppStore.getInitialState(), true);
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
}

test('creation captures input, survives dialog unmount and never overrides subsequent navigation', async (t) => {
  const pending = Promise.withResolvers();
  const submitted = [];
  setup(t, {
    projects: {
      create: async (options) => {
        submitted.push(options);
        return pending.promise;
      },
    },
    sessions: { listForProject: async () => [], listIdsForProject: async () => [] },
    config: { setLastAgent: async () => {} },
  });
  const project = { id: 'codex:repo', agent: 'codex', realPath: 'C:\\repo', displayName: 'Repo' };
  const options = { agent: 'codex', mode: 'folder', basePath: project.realPath };
  useAppStore.setState({ activeTabId: 'original', selectedProjectId: 'original-project' });
  const id = queueProjectCreation(options);
  assert.ok(id);
  assert.equal(queueProjectCreation({ ...options, basePath: 'c:/repo/' }), null);
  options.basePath = 'C:\\changed';
  // No component owns this operation; further navigation may happen while its IPC is pending.
  useAppStore.setState({ activeTabId: 'another', selectedProjectId: 'another-project' });
  useAppStore.setState({ activeTabId: 'original', selectedProjectId: 'original-project' });
  await tick();
  assert.equal(submitted[0].basePath, project.realPath);
  assert.equal(useBackgroundOperations.getState().operations[0].status, 'running');
  pending.resolve(project);
  await tick();
  assert.equal(useAppStore.getState().activeTabId, 'original');
  assert.equal(useBackgroundOperations.getState().operations[0].status, 'succeeded');
  assert.equal(useBackgroundOperations.getState().operations[0].projectId, project.id);
});

test('deletion captures its target and errors remain visible after the source list disappears', async (t) => {
  const pending = Promise.withResolvers();
  const deleted = [];
  setup(t, {
    sessions: {
      delete: async (...args) => {
        deleted.push(args);
        await pending.promise;
      },
    },
  });
  const project = { id: 'claude:repo', displayName: 'Repo' };
  const session = { id: 'one', agent: 'claude', title: 'Original' };
  queueSessionDeletion(project, session);
  project.id = 'other';
  session.id = 'two';
  useAppStore.setState({ projects: [], selectedProjectId: null });
  await tick();
  assert.deepEqual(deleted, [['claude:repo', 'one']]);
  pending.reject(new Error('Permission denied'));
  await tick();
  assert.equal(useBackgroundOperations.getState().operations[0].status, 'failed');
  assert.match(useBackgroundOperations.getState().operations[0].message, /Permission denied/);
});

test('batch session resources reject overlap with single deletion and retain partial-failure warnings', async (t) => {
  const pending = Promise.withResolvers();
  setup(t, {
    sessions: {
      delete: async (_project, id) => {
        await pending.promise;
        if (id === 'bad') throw new Error('Blocked');
      },
      listForProject: async () => [],
    },
    projects: { list: async () => [] },
  });
  const project = { id: 'claude:repo' };
  const one = { id: 'one', agent: 'claude', title: 'One' };
  const bad = { ...one, id: 'bad', title: 'Bad' };
  assert.equal(typeof workspaceOperations.queueSessionsDeletion, 'function');
  workspaceOperations.queueSessionsDeletion([
    { project, session: one },
    { project, session: bad },
  ]);
  assert.equal(queueSessionDeletion(project, one), null);
  pending.resolve();
  await tick();
  assert.equal(useBackgroundOperations.getState().operations[0].warning, true);
  assert.match(useBackgroundOperations.getState().operations[0].message, /1.*deleted.*1.*failed/);
});

test('bulk and single project deletion reject overlap without issuing a second IPC', async (t) => {
  const pending = Promise.withResolvers();
  let calls = 0;
  setup(t, {
    projects: {
      delete: async () => {
        calls++;
        await pending.promise;
      },
      list: async () => [],
    },
  });
  const project = { id: 'codex:repo', displayName: 'Repo' };
  queueProjectDeletion([project]);
  assert.equal(queueProjectDeletion([project], true), null);
  await tick();
  assert.equal(calls, 1);
  pending.resolve();
  await tick();
  assert.equal(useBackgroundOperations.getState().operations[0].status, 'succeeded');
});
