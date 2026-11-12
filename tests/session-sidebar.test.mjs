import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import { resumeCommandFor } from '../src/shared/agent-commands.ts';
import { collectProjectSessions, pathKey } from '../src/shared/project-tree.ts';
import { draftSessionRows } from '../src/shared/managed-session.ts';

const require = createRequire(import.meta.url);

// Exercise component handlers across renders without a DOM or provider processes.
async function componentHarness(name, state = {}) {
  for (const [key, value] of Object.entries({
    openTabs: [],
    managedTabs: {},
    tabProjectId: {},
    tabSessionId: {},
    tabAgent: {},
  }))
    state[key] ??= value;
  const slots = [];
  const listeners = new Map();
  const focused = [];
  let cursor = 0;
  let effects = [];
  const react = {
    useMemo: (callback) => callback(),
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [slots[index].value, (value) => (slots[index].value = value)];
    },
    useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((dep, i) => !Object.is(dep, slots[index].deps[i]))) {
        effects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const { code } = await transform(
    await readFile(new URL(`../src/renderer/components/${name}.tsx`, import.meta.url), 'utf8'),
    { loader: 'tsx', format: 'cjs', jsx: 'automatic' },
  );
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', code)(
    (id) => {
      if (id === 'react') return react;
      if (id === 'zustand/react/shallow') return { useShallow: (select) => select };
      if (id === '../store/app-store') return { useAppStore: (select) => select(state) };
      if (id === '../icons/agentIcons') return { resumeCommandFor };
      if (id === '../store/activity-store')
        return {
          useActivityStore: (select) =>
            select({
              records: state.activityRecord ? [state.activityRecord] : [],
              completions: state.completions ?? {},
              acknowledge: (token) => state.acknowledge?.(token),
            }),
          sessionActivity: () => 'unknown',
          sessionActivityRecord: (_records, _agent, sessionId) =>
            state.activityRecord?.sessionId === sessionId ? state.activityRecord : undefined,
        };
      if (id === '../../shared/project-tree') return { collectProjectSessions, pathKey };
      if (id === '../hooks/use-windowed-rows')
        return {
          useWindowedRows: (keys, activeKey) => {
            state.windowedActiveKey = activeKey;
            return {
              root: { current: null },
              rows: keys.map((key) => ({ key, visible: true })),
              setFocused() {},
            };
          },
        };
      if (id === '../hooks/use-session-order')
        return {
          sessionRowKey: (row, launches) =>
            row.kind === 'history'
              ? `${row.session.agent}:${row.session.id}`
              : `draft:${launches[row.tabId].launchId}`,
          useSessionOrder: (_projects, rows) => ({
            ordered: rows,
            loaded: true,
            saving: false,
            error: '',
            move: async (...args) => state.moveSession?.(...args),
            reload: async () => {},
          }),
        };
      if (id === '../../shared/managed-session') return { draftSessionRows };
      if (id === '../store/workspace-operations')
        return { queueSessionDeletion: (...args) => state.queueSessionDeletion(...args) };
      if (id.startsWith('./')) {
        const component = id.slice(2);
        return { [component]: component };
      }
      return require(id);
    },
    module,
    module.exports,
    {
      addEventListener: (type, handler) => listeners.set(type, handler),
      removeEventListener: (type) => listeners.delete(type),
    },
  );
  return {
    focused,
    listeners,
    render(props = {}) {
      cursor = 0;
      effects = [];
      const tree = module.exports[name](
        name === 'SessionList' ? { projects: state.projects, ...props } : props,
      );
      for (const element of elements(tree)) {
        if (element.ref && element.type === 'input') {
          element.ref.current = { focus: () => focused.push(element.props.type ?? 'text') };
        }
      }
      effects.forEach((effect) => effect());
      return tree;
    },
  };
}

function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(elements)];
}

const find = (tree, predicate) => elements(tree).find(predicate);
const rows = (tree) =>
  elements(tree).filter((node) => node.props?.className?.includes('session-item'));
const checkbox = (tree) => find(tree, (node) => node.props.type === 'checkbox');
const confirmButton = (tree) => find(tree, (node) => node.props.className === 'btn-danger');

function sessionState() {
  const projectId = 'claude:repo';
  const sessions = ['first', 'second'].map((id) => ({
    id,
    projectId,
    agent: 'claude',
    title: `Session ${id}`,
    timestamp: 1_700_000_000_000,
  }));
  return {
    selectedProjectId: projectId,
    loadSessions: async () => {},
    projects: [{ id: projectId, exists: true }],
    sessions: { [projectId]: sessions },
    activeTabId: 'tab-one',
    openTabs: ['tab-one', 'tab-two'],
    tabProjectId: { 'tab-one': projectId, 'tab-two': projectId },
    tabSessionId: { 'tab-one': 'first', 'tab-two': 'second' },
    tabAgent: { 'tab-one': 'claude', 'tab-two': 'claude' },
  };
}

test('session highlight and arrow follow the active tab rather than the last clicked row', async () => {
  const state = sessionState();
  const { render } = await componentHarness('SessionList', state);
  for (const [tabId, activeId] of [
    ['tab-one', 'first'],
    ['tab-two', 'second'],
  ]) {
    state.activeTabId = tabId;
    const items = rows(render());
    for (const row of items) {
      const active = row.key === `claude:${activeId}`;
      assert.equal(row.props.className.split(' ').includes('active'), active);
      assert.equal(
        find(row, (node) => node.props.className === 'session-open').props['aria-current'],
        active ? 'true' : undefined,
      );
      const marker = find(row, (node) => node.props.className?.includes('session-marker'));
      assert.equal(marker.props.children, active ? '▶' : undefined);
      assert.equal(marker.props['aria-hidden'], 'true');
    }
  }
});

test('no session is highlighted for absent, unbound or other-agent tabs', async () => {
  const state = sessionState();
  const { render } = await componentHarness('SessionList', state);
  const cases = [
    { activeTabId: null },
    { activeTabId: 'unknown' },
    { tabSessionId: { 'tab-one': null } },
    { tabAgent: { 'tab-one': 'copilot' } },
  ];
  for (const change of cases) {
    Object.assign(state, sessionState(), change);
    assert.equal(
      rows(render()).filter((row) => row.props.className.split(' ').includes('active')).length,
      0,
    );
  }
});

test('completion icon is a sibling control; icon acknowledges only, session title also resumes', async () => {
  const state = sessionState();
  const acknowledgements = [];
  const resumes = [];
  state.activityRecord = {
    terminalKey: 'tab-one::agent',
    sessionId: 'first',
    agent: 'claude',
    revision: 1,
    state: 'completed',
  };
  state.completions = { 'tab-one::agent': { token: 'completion-one', acknowledged: false } };
  state.acknowledge = (token) => acknowledgements.push(token);
  state.selectProject = async () => {};
  state.openSessionTab = async (_project, session) => resumes.push(session.id);
  const { render } = await componentHarness('SessionList', state);
  const row = rows(render())[0];
  const icon = find(row, (node) => node.type === 'SessionActivityIcon');
  assert.equal(icon.props.attention, true);
  assert.equal(
    find(
      find(row, (node) => node.props.className === 'session-open'),
      (node) => node.type === 'SessionActivityIcon',
    ),
    undefined,
  );
  icon.props.onAcknowledge();
  assert.deepEqual(acknowledgements, ['completion-one']);
  assert.deepEqual(resumes, []);
  await find(row, (node) => node.props.className === 'session-open').props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(resumes, ['first']);
  assert.deepEqual(acknowledgements, ['completion-one', 'completion-one']);
});

test('history-only sessions are not open; inactive linked tabs remain open across aliases and provider collisions', async () => {
  const state = sessionState();
  state.openTabs = ['tab-one', 'tab-two'];
  const { render } = await componentHarness('SessionList', state);
  const icon = (id) =>
    find(
      rows(render()).find((row) => row.key === `claude:${id}`),
      (node) => node.type === 'SessionActivityIcon',
    );
  assert.equal(icon('first').props.isOpen, true);
  assert.equal(icon('second').props.isOpen, true);
  state.openTabs = ['tab-one'];
  assert.equal(icon('first').props.isOpen, true);
  assert.equal(icon('second').props.isOpen, false);
  state.tabSessionId = { 'tab-one': 'second' };
  state.tabAgent = { 'tab-one': 'codex' };
  assert.equal(icon('second').props.isOpen, false);
  state.tabAgent = { 'tab-one': 'claude' };
  state.tabProjectId = { 'tab-one': 'claude:shared-history-alias' };
  assert.equal(icon('second').props.isOpen, true);
  state.tabSessionId = { 'tab-one': null };
  assert.equal(icon('second').props.isOpen, false);
});

test('shared-history aliases retain activity and completion acknowledgement from their open tab', async () => {
  const state = sessionState();
  state.tabProjectId['tab-one'] = 'claude:shared-history-alias';
  state.activityRecord = {
    terminalKey: 'tab-one::agent',
    sessionId: 'first',
    agent: 'claude',
    revision: 1,
    state: 'completed',
  };
  state.completions = { 'tab-one::agent': { token: 'alias-completion', acknowledged: false } };
  const acknowledged = [];
  state.acknowledge = (token) => acknowledged.push(token);
  const { render } = await componentHarness('SessionList', state);
  const icon = find(rows(render())[0], (node) => node.type === 'SessionActivityIcon');
  assert.equal(icon.props.isOpen, true);
  assert.equal(icon.props.state, 'completed');
  assert.equal(icon.props.attention, true);
  icon.props.onAcknowledge();
  assert.deepEqual(acknowledged, ['alias-completion']);
});

test('windowing pins the active unbound draft using its launch identity', async () => {
  const state = sessionState();
  state.activeTabId = 'draft-tab';
  state.openTabs.push('draft-tab');
  state.tabProjectId['draft-tab'] = state.projects[0].id;
  state.tabAgent['draft-tab'] = 'claude';
  state.managedTabs = {
    'draft-tab': { launchId: 'draft-launch', createdAt: 1, sessionTitle: 'Draft' },
  };
  const { render } = await componentHarness('SessionList', state);
  render();
  assert.equal(state.windowedActiveKey, 'draft:draft-launch');
});

test('selection checkboxes are controlled independently of the active terminal', async () => {
  const state = sessionState();
  let launches = 0;
  state.openSessionTab = async () => {
    launches++;
  };
  const changed = [];
  const { render } = await componentHarness('SessionList', state);
  const tree = render({
    selection: { selectedKeys: ['claude:second'], onToggle: (...args) => changed.push(args) },
  });
  const items = rows(tree);
  const check = find(items[1], (node) => node.props.className === 'session-selection-check');
  assert.ok(check);
  assert.equal(check.props.checked, true);
  check.props.onChange({ target: { checked: false } });
  assert.deepEqual(changed, [['claude:second', false]]);
  assert.equal(launches, 0);
  assert.equal(items[0].props.className.includes('active'), true);
});

test('empty worktree placeholders are hidden without hiding the parent empty message', async () => {
  const state = sessionState();
  state.openTabs = [];
  state.sessions = {};
  state.projects = [
    { id: 'claude:base', exists: true },
    {
      id: 'claude:worktree',
      exists: true,
      worktree: { parentPath: 'C:/base', branch: 'feat/empty' },
    },
  ];
  const { render } = await componentHarness('SessionList', state);
  const notices = elements(render()).filter((node) => node.props?.className === 'session-notice');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].key, 'claude:base');
});

test('empty projects have no Start session button', async () => {
  const state = sessionState();
  state.sessions = {};
  const { render } = await componentHarness('SessionList', state);
  assert.equal(
    find(render(), (node) => node.type === 'button' && node.props.children === 'Start session'),
    undefined,
  );
});

test('session deletion delegates the exact target to the shared review and closes only on acceptance', async () => {
  const list = await componentHarness('SessionList', sessionState());
  find(rows(list.render())[0], (node) => node.props.className === 'session-delete').props.onClick();
  let dialog = find(list.render(), (node) => node.type === 'SessionDeleteDialog');
  assert.equal(dialog.props.targets[0].session.id, 'first');
  dialog.props.onCancel();
  assert.equal(
    find(list.render(), (node) => node.type === 'SessionDeleteDialog'),
    undefined,
  );
  find(rows(list.render())[0], (node) => node.props.className === 'session-delete').props.onClick();
  dialog = find(list.render(), (node) => node.type === 'SessionDeleteDialog');
  dialog.props.onAccepted();
  assert.equal(
    find(list.render(), (node) => node.type === 'SessionDeleteDialog'),
    undefined,
  );
});

test('checkbox confirmation preserves cancellation and externally disabled actions', async () => {
  let confirmed = 0;
  let cancelled = 0;
  const harness = await componentHarness('ConfirmDialog');
  const props = {
    title: 'Delete session?',
    message: 'Permanent deletion',
    confirmText: 'Delete forever',
    destructive: true,
    onConfirm: () => confirmed++,
    onCancel: () => cancelled++,
  };
  let tree = harness.render(props);
  checkbox(tree).props.onChange({ target: { checked: true } });
  tree = harness.render({ ...props, confirmDisabled: true });
  assert.equal(confirmButton(tree).props.disabled, true);
  confirmButton(tree).props.onClick();
  find(tree, (node) => node.props.className === 'btn-secondary').props.onClick();
  tree.props.onClick();
  harness.listeners.get('keydown')({ key: 'Escape' });
  assert.equal(cancelled, 3);
  assert.equal(confirmed, 0);
});

test('typed confirmation still requires both exact filename and acknowledgement', async () => {
  const harness = await componentHarness('ConfirmDialog');
  let confirmed = 0;
  const props = {
    title: 'Delete file?',
    message: 'Recycle Bin',
    confirmText: 'Move to Recycle Bin',
    typeToConfirm: 'notes.txt',
    destructive: true,
    onConfirm: () => confirmed++,
    onCancel() {},
  };
  let tree = harness.render(props);
  assert.equal(harness.focused.at(-1), 'text');
  checkbox(tree).props.onChange({ target: { checked: true } });
  tree = harness.render(props);
  assert.equal(confirmButton(tree).props.disabled, true);
  const input = (tree) => find(tree, (node) => node.props.className === 'modal-input');
  input(tree).props.onChange({ target: { value: 'Notes.txt' } });
  assert.equal(confirmButton(harness.render(props)).props.disabled, true);
  input(tree).props.onChange({ target: { value: 'notes.txt' } });
  tree = harness.render(props);
  assert.equal(confirmButton(tree).props.disabled, false);
  confirmButton(tree).props.onClick();
  assert.equal(confirmed, 1);
  checkbox(tree).props.onChange({ target: { checked: false } });
  assert.equal(confirmButton(harness.render(props)).props.disabled, true);
});
