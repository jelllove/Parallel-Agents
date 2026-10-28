import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build, transform } from 'esbuild';
import * as ordering from '../src/shared/sidebar-order.ts';
import * as projectTree from '../src/shared/project-tree.ts';

const require = createRequire(import.meta.url);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const project = (id, pinned = false, agent = 'claude') => ({
  id,
  agent,
  displayName: id,
  realPath: `C:\\fixture\\${id}`,
  exists: true,
  hidden: false,
  pinned,
});
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...[tree.props?.children].flat(Infinity).flatMap((child) => nodes(child, predicate)),
  ];
}
const byLabel = (tree, label) => nodes(tree, (node) => node.props?.['aria-label'] === label)[0];
const groups = (tree) =>
  nodes(tree, (node) => node.props?.['data-agent-id']).map((node) => node.props['data-agent-id']);
const header = (tree, agent) =>
  nodes(nodes(tree, (node) => node.props?.['data-agent-id'] === agent)[0], (node) =>
    node.props?.className?.startsWith('agent-group-header'),
  )[0];
const row = (tree, id) => nodes(tree, (node) => node.props?.['data-project-row'] === id)[0];
function event() {
  return {
    prevented: false,
    stopped: false,
    clientX: 1,
    clientY: 2,
    currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 20 }) },
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
    dataTransfer: { setData() {} },
  };
}

async function harness({ config = {}, projects = [] } = {}) {
  const calls = [];
  let layout = { agentOrder: [...ordering.DEFAULT_AGENT_ORDER], pinnedAgents: [] };
  const state = {
    projects,
    collapsedAgents: [],
    agentOrder: [...layout.agentOrder],
    pinnedAgents: [],
    expandedProjects: [],
    sidebarTreeLoaded: false,
    agentStatus: {},
    agents: [],
    showHidden: false,
    inventoryRefreshing: false,
    inventoryError: null,
    toggleAgentGroup: (agent) => calls.push(['collapse', agent]),
    pinProject: async (...args) => calls.push(['pinProject', ...args]),
    reorderProjects: async (...args) => calls.push(['reorderProjects', ...args]),
    loadProjects: async () => {},
  };
  for (const id of ordering.DEFAULT_AGENT_ORDER) {
    state.agents.push({ id, displayName: id });
    state.agentStatus[id] = { available: true };
  }
  const api = {
    getAgentLayout: async () => structuredClone(layout),
    setAgentPinned: async (agent, pinned) => {
      calls.push(['pinAgent', agent, pinned]);
      layout.pinnedAgents = pinned
        ? [...layout.pinnedAgents, agent]
        : layout.pinnedAgents.filter((id) => id !== agent);
    },
    setAgentOrder: async (order) => {
      calls.push(['agentOrder', order]);
      layout.agentOrder = [...order];
    },
    ...config,
  };
  state.pinAgent = async (agent) => {
    await api.setAgentPinned(agent, !state.pinnedAgents.includes(agent));
    Object.assign(state, await api.getAgentLayout());
  };
  state.reorderAgentGroups = async (from, to, placement) => {
    const next = state.agentOrder.filter((id) => id !== from);
    next.splice(next.indexOf(to) + (placement === 'after' ? 1 : 0), 0, from);
    await api.setAgentOrder(next);
    Object.assign(state, await api.getAgentLayout());
  };
  state.loadSidebarTree = async () => {
    try {
      Object.assign(state, await api.getAgentLayout());
      state.sidebarTreeLoaded = true;
      state.sidebarTreeError = null;
    } catch (error) {
      state.sidebarTreeError = String(error);
    }
  };
  state.saveSidebarTree = async () => {};
  await state.loadSidebarTree();
  const slots = [];
  let cursor = 0;
  let effects = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [
        slots[index].value,
        (value) => {
          slots[index].value = typeof value === 'function' ? value(slots[index].value) : value;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },
    useMemo: (fn) => fn(),
    useEffect(effect, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((v, n) => !Object.is(v, slots[index].deps[n]))) {
        slots[index]?.cleanup?.();
        slots[index] = { deps };
        effects.push(() => {
          slots[index].cleanup = effect();
        });
      }
    },
  };
  const useAppStore = (selector) => selector(state);
  useAppStore.getState = () => state;
  const source = await readFile(
    new URL('../src/renderer/components/ProjectList.tsx', import.meta.url),
    'utf8',
  );
  const { code } = await transform(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', code)(
    (id) => {
      if (id === 'react') return react;
      if (id === '../store/app-store') return { useAppStore };
      if (id === '../../shared/sidebar-order') return ordering;
      if (id === '../../shared/project-tree') return projectTree;
      if (id === '../../shared/project-delete') return { canDeleteProject: () => true };
      if (id === '../icons/iconResolver') return { folderIconUrl: () => '' };
      if (id.startsWith('./')) return { [id.slice(2)]: id.slice(2) };
      return require(id);
    },
    module,
    module.exports,
    { api: { config: api } },
  );
  const render = () => {
    cursor = 0;
    effects = [];
    const tree = module.exports.ProjectList({ onNewProject: (id) => calls.push(['new', id]) });
    effects.forEach((effect) => effect());
    return tree;
  };
  render();
  await flush();
  return { render, calls, state, unmount: () => slots.forEach((slot) => slot.cleanup?.()) };
}

test('each quick-create button targets its agent without toggling the group; unavailable CLIs stay disabled', async () => {
  const h = await harness();
  for (const agent of ordering.DEFAULT_AGENT_ORDER) {
    const click = event();
    byLabel(h.render(), `New project with ${agent}`).props.onClick(click);
    assert.equal(click.stopped, true);
    assert.deepEqual(h.calls.at(-1), ['new', agent]);
  }
  assert.equal(
    h.calls.some(([type]) => type === 'collapse'),
    false,
  );
  h.state.agentStatus.aider.available = false;
  assert.equal(byLabel(h.render(), 'New project with aider').props.disabled, true);
});

test('agent pinning changes group order only after persistence, without collapsing the group', async () => {
  const h = await harness();
  const click = event();
  byLabel(h.render(), 'Pin claude').props.onClick(click);
  await flush();
  assert.equal(click.stopped, true);
  assert.equal(groups(h.render())[0], 'claude');
  assert.equal(byLabel(h.render(), 'Unpin claude').props['aria-pressed'], true);
  assert.deepEqual(h.calls, [['pinAgent', 'claude', true]]);
});

test('agent drag order persists, pin boundaries reject drops, and cancelled drag clears the target', async () => {
  const h = await harness();
  header(h.render(), 'gemini').props.onDragStart(event());
  let target = header(h.render(), 'copilot');
  const over = event();
  target.props.onDragOver(over);
  assert.equal(over.prevented, true);
  header(h.render(), 'copilot').props.onDrop(event());
  await flush();
  assert.equal(groups(h.render())[0], 'gemini');
  byLabel(h.render(), 'Pin claude').props.onClick(event());
  await flush();
  header(h.render(), 'gemini').props.onDragStart(event());
  const blocked = event();
  header(h.render(), 'claude').props.onDragOver(blocked);
  assert.equal(blocked.prevented, false);
  header(h.render(), 'copilot').props.onDragOver(event());
  assert.match(header(h.render(), 'copilot').props.className, /agent-drop-before/);
  header(h.render(), 'gemini').props.onDragEnd();
  assert.doesNotMatch(header(h.render(), 'copilot').props.className, /agent-drop-before/);
});

test('project pins stop row clicks; dragging cannot cross agent or pin boundaries', async () => {
  const h = await harness({
    projects: [
      project('one'),
      project('two'),
      project('pinned', true),
      project('foreign', false, 'copilot'),
    ],
  });
  const click = event();
  const pinButton = byLabel(h.render(), 'Pin project one');
  assert.ok(
    [row(h.render(), 'one').props.children]
      .flat()
      .some((child) => child?.props?.['aria-label'] === pinButton.props['aria-label']),
    'The project pin belongs beside the text, not between the name and path',
  );
  byLabel(h.render(), 'Pin project one').props.onClick(click);
  await flush();
  assert.equal(click.stopped, true);
  assert.deepEqual(h.calls[0], ['pinProject', 'one', true]);
  row(h.render(), 'one').props.onDragStart(event());
  for (const id of ['pinned', 'foreign']) {
    const over = event();
    row(h.render(), id).props.onDragOver(over);
    assert.equal(over.prevented, false);
  }
  await row(h.render(), 'two').props.onDrop(event());
  assert.deepEqual(h.calls.at(-1), ['reorderProjects', 'claude', 'one', 'two']);
  assert.equal(
    h.calls.some(([type]) => type === 'agentOrder'),
    false,
  );
});

test('failed sidebar writes remain visible and do not publish an unsaved pin', async () => {
  const h = await harness({
    config: {
      setAgentPinned: async () => {
        throw new Error('disk full');
      },
    },
  });
  byLabel(h.render(), 'Pin claude').props.onClick(event());
  await flush();
  const alert = nodes(h.render(), (node) => node.props?.role === 'alert')[0];
  assert.match(String(alert.props.children[0]), /disk full/);
  assert.deepEqual(groups(h.render()), ordering.DEFAULT_AGENT_ORDER);
  assert.ok(byLabel(h.render(), 'Pin claude'));
});

test('right-click move actions stay within the current pin section for agents and projects', async () => {
  const h = await harness({ projects: [project('pinned', true), project('one'), project('two')] });
  const menuButton = (label) =>
    nodes(h.render(), (node) => node.type === 'button' && node.props.children === label)[0];
  header(h.render(), 'copilot').props.onContextMenu(event());
  assert.equal(menuButton('Move up').props.disabled, true);
  menuButton('Move down').props.onClick();
  await flush();
  assert.deepEqual(groups(h.render()).slice(0, 2), ['codex', 'copilot']);
  row(h.render(), 'one').props.onContextMenu(event());
  assert.equal(menuButton('Move up').props.disabled, true);
  assert.equal(menuButton('Move down').props.disabled, false);
  menuButton('Move down').props.onClick();
  await flush();
  assert.deepEqual(h.calls.at(-1), ['reorderProjects', 'claude', 'one', 'two']);
});

test('load failure exposes retry and disables ordering until persisted state is available', async () => {
  let attempts = 0;
  const h = await harness({
    config: {
      getAgentLayout: async () => {
        if (++attempts === 1) throw new Error('cannot read config');
        return { agentOrder: [...ordering.DEFAULT_AGENT_ORDER], pinnedAgents: ['aider'] };
      },
    },
  });
  assert.equal(byLabel(h.render(), 'Pin claude').props.disabled, true);
  const retry = nodes(
    h.render(),
    (node) => node.type === 'button' && node.props.children === 'Retry',
  )[0];
  retry.props.onClick();
  await flush();
  assert.equal(groups(h.render())[0], 'aider');
  assert.equal(byLabel(h.render(), 'Pin claude').props.disabled, false);
});

test('duplicate pin clicks while saving do not issue duplicate writes', async () => {
  const pending = Promise.withResolvers();
  let writes = 0;
  const h = await harness({
    config: {
      setAgentPinned: async () => {
        writes++;
        await pending.promise;
      },
    },
  });
  const pin = byLabel(h.render(), 'Pin claude');
  pin.props.onClick(event());
  pin.props.onClick(event());
  assert.equal(writes, 1);
  assert.equal(byLabel(h.render(), 'Pin claude').props.disabled, true);
  pending.resolve();
  await flush();
});

test('store project reorder preserves hidden IDs, rejects cross-pin moves and surfaces write failure', async () => {
  const result = await build({
    entryPoints: ['src/renderer/store/app-store.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    loader: { '.png': 'dataurl' },
  });
  const items = [
    project('pinned', true),
    project('one'),
    { ...project('hidden'), hidden: true },
    project('two'),
  ];
  let saved;
  let fail = false;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', result.outputFiles[0].text)(
    require,
    module,
    module.exports,
    {
      api: {
        projects: {
          list: async () => items,
          setOrder: async (_agent, ids) => {
            if (fail) throw new Error('write failed');
            saved = ids;
          },
        },
      },
    },
  );
  const store = module.exports.useAppStore;
  store.setState({ projects: items });
  await store.getState().reorderProjects('claude', 'two', 'one');
  assert.deepEqual(saved, ['pinned', 'two', 'one', 'hidden']);
  await assert.rejects(
    store.getState().reorderProjects('claude', 'one', 'pinned'),
    /pinned section/,
  );
  await assert.rejects(store.getState().reorderProjects('copilot', 'one', 'two'), /same agent/);
  fail = true;
  await assert.rejects(store.getState().reorderProjects('claude', 'one', 'two'), /write failed/);
  assert.deepEqual(store.getState().projects, items);
});
