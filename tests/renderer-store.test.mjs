import assert from 'node:assert/strict';
import test from 'node:test';

import { useAppStore } from '../src/renderer/store/app-store.ts';

function setup(t) {
  const previousWindow = globalThis.window;
  const killed = [];
  globalThis.window = {
    api: {
      config: { setLastAgent: async () => {} },
      sessions: { listForProject: async () => [] },
      pty: {
        kill: async (id) => {
          killed.push(id);
        },
      },
    },
  };
  useAppStore.setState(useAppStore.getInitialState(), true);
  t.after(() => {
    useAppStore.setState(useAppStore.getInitialState(), true);
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  return { killed };
}

test('closing a not-yet-mounted tab cancels its pending launch', (t) => {
  const { killed } = setup(t);
  useAppStore.setState({
    openTabs: ['closed', 'remaining'],
    activeTabId: 'closed',
    pendingInitialCommand: {
      closed: { command: 'cancelled-command', extraPath: [] },
      remaining: { command: 'remaining-command', extraPath: [] },
    },
    tabRespawnNonce: { closed: 2, remaining: 3 },
  });

  useAppStore.getState().closeTab('closed');

  const state = useAppStore.getState();
  assert.deepEqual(state.openTabs, ['remaining']);
  assert.equal(state.activeTabId, 'remaining');
  assert.equal(state.pendingInitialCommand.closed, undefined);
  assert.equal(state.tabRespawnNonce.closed, undefined);
  assert.equal(state.pendingInitialCommand.remaining.command, 'remaining-command');
  assert.deepEqual(killed, ['closed::agent']);
});

test('concurrent tab launches retain both tabs after asynchronous configuration writes', async (t) => {
  setup(t);
  const gate = Promise.withResolvers();
  globalThis.window.api.config.setLastAgent = () => gate.promise;

  const first = useAppStore.getState().openTabWithAgent('first', 'claude', 'claude');
  const second = useAppStore.getState().openTabWithAgent('second', 'copilot', 'copilot');
  gate.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(useAppStore.getState().openTabs, ['first', 'second']);
  assert.equal(useAppStore.getState().pendingInitialCommand.first.command, 'claude');
  assert.equal(useAppStore.getState().pendingInitialCommand.second.command, 'copilot');
});

test('a pending launch is consumed exactly once when the terminal mounts', (t) => {
  setup(t);
  const pending = { command: 'copilot --continue', extraPath: ['C:\\tools'] };
  useAppStore.setState({ pendingInitialCommand: { tab: pending } });

  assert.deepEqual(useAppStore.getState().consumePendingCommand('tab'), pending);
  assert.equal(useAppStore.getState().consumePendingCommand('tab'), undefined);
});

test('agent availability is marked checked only after detection succeeds', async (t) => {
  setup(t);
  const detection = Promise.withResolvers();
  globalThis.window.api.agents = { checkAll: () => detection.promise };
  assert.equal(useAppStore.getState().agentsChecked, false);
  const checking = useAppStore.getState().checkAgents();
  assert.equal(useAppStore.getState().agentsChecked, false);
  const status = { claude: { available: false, path: null } };
  detection.resolve(status);
  await checking;
  assert.equal(useAppStore.getState().agentsChecked, true);
  assert.deepEqual(useAppStore.getState().agentStatus, status);
});

test('failed agent detection does not claim that unchecked tools are missing', async (t) => {
  setup(t);
  globalThis.window.api.agents = {
    checkAll: async () => {
      throw new Error('Detection failed');
    },
  };
  await assert.rejects(useAppStore.getState().checkAgents(), /Detection failed/);
  assert.equal(useAppStore.getState().agentsChecked, false);
});

test('collapsed pane projections cannot replace the saved expanded layout sizes', (t) => {
  setup(t);
  const layout = {
    order: ['sidebar', 'middle', 'right'],
    sizes: [20, 58, 22],
    hiddenPanes: ['sidebar', 'right'],
  };
  useAppStore.setState({ layout });
  useAppStore.getState().updateLayoutSizes([0, 100, 0]);
  assert.deepEqual(useAppStore.getState().layout, layout);
});

test('failed visibility persistence reports an error and restores the previous layout', async (t) => {
  setup(t);
  globalThis.window.api.config.setLayout = async () => {
    throw new Error('Disk unavailable');
  };
  const before = { order: ['sidebar', 'middle', 'right'], sizes: [20, 58, 22] };
  useAppStore.setState({ layout: before });
  await assert.rejects(
    useAppStore.getState().setLayout({ ...before, hiddenPanes: ['sidebar'] }),
    /Disk unavailable/,
  );
  assert.deepEqual(useAppStore.getState().layout, before);
  assert.match(useAppStore.getState().layoutError, /Disk unavailable/);
});

test('constraint callbacks during a pending sidebar restore cannot erase rollback or expanded widths', async (t) => {
  setup(t);
  const pending = Promise.withResolvers();
  globalThis.window.api.config.setLayout = () => pending.promise;
  const previous = {
    order: ['sidebar', 'middle', 'right'],
    sizes: [20, 58, 22],
    hiddenPanes: ['sidebar'],
  };
  useAppStore.setState({ layout: previous });
  const restoring = useAppStore.getState().setLayout({ ...previous, hiddenPanes: [] });
  useAppStore.getState().updateLayoutSizes([14, 64, 22]);
  useAppStore.getState().updateLayoutSizes([20, 58, 22]);
  pending.reject(new Error('Restore write failed'));
  await assert.rejects(restoring, /Restore write failed/);
  assert.deepEqual(useAppStore.getState().layout, previous);
  assert.equal(useAppStore.getState().layoutSaving, false);
});
