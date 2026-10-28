import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import { canDeleteProject } from '../src/shared/project-delete.ts';

const require = createRequire(import.meta.url);
const agents = ['copilot', 'codex', 'claude', 'gemini', 'aider'].map((id) => ({
  id,
  displayName: id,
  installHint: `install ${id}`,
  installUrl: `https://example.com/${id}/install`,
}));
const { code } = await transform(
  await readFile(new URL('../src/renderer/components/ProjectList.tsx', import.meta.url), 'utf8'),
  { loader: 'tsx', format: 'cjs', jsx: 'automatic' },
);

function harness(overrides = {}, openExternal = async () => {}) {
  const slots = [];
  let cursor = 0;
  const toggles = [];
  const state = {
    projects: [],
    agents,
    agentStatus: Object.fromEntries(agents.map(({ id }) => [id, { available: true, path: id }])),
    agentsChecked: true,
    collapsedAgents: [],
    toggleAgentGroup: (id) => toggles.push(id),
    ...overrides,
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [
        slots[index].value,
        (next) => {
          slots[index].value = typeof next === 'function' ? next(slots[index].value) : next;
        },
      ];
    },
    useMemo: (calculate) => calculate(),
    useEffect() {},
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', code)(
    (id) => {
      if (id === 'react') return react;
      if (id === '../store/app-store') return { useAppStore: (select) => select(state) };
      if (id === '../icons/iconResolver') return { folderIconUrl: () => 'folder.svg' };
      if (id === '../../shared/project-delete') return { canDeleteProject };
      if (id === './AgentIcon') return { AgentIcon: 'agent-icon' };
      if (id === './ActionIcon') return { ActionIcon: 'action-icon' };
      if (id === './ProjectDeleteDialog') return { ProjectDeleteDialog: 'delete-dialog' };
      return require(id);
    },
    module,
    module.exports,
    { api: { shell: { openExternal } } },
  );
  return {
    state,
    toggles,
    render() {
      cursor = 0;
      return module.exports.ProjectList();
    },
  };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const match = find(child, predicate);
    if (match) return match;
  }
}

const installButton = (tree, agent) =>
  find(tree, (node) => node.type === 'button' && node.props['aria-label'] === `Install ${agent}`);

test('only detected missing agents show an emoji and a compact installation action', () => {
  const h = harness();
  h.state.agentStatus.claude = { available: false, path: null };
  const tree = h.render();
  assert.ok(installButton(tree, 'claude'));
  assert.equal(installButton(tree, 'copilot'), undefined);
  const warning = find(
    tree,
    (node) => node.props?.role === 'img' && node.props['aria-label'] === 'Not installed',
  );
  assert.match(warning.props.children, /⚠/);
  assert.match(installButton(tree, 'claude').props.title, /install claude/);
  const toggle = find(
    tree,
    (node) => node.type === 'button' && node.props['aria-label'] === 'claude (not installed)',
  );
  assert.equal(toggle.props['aria-expanded'], true);
});

test('unchecked agent statuses do not flash missing indicators during startup', () => {
  const h = harness({ agentsChecked: false });
  h.state.agentStatus.claude = { available: false, path: null };
  assert.equal(installButton(h.render(), 'claude'), undefined);
  assert.equal(
    find(h.render(), (node) => node.props?.['aria-label'] === 'Not installed'),
    undefined,
  );
});

test('installation guidance remains accessible for collapsed and empty agent groups without toggling them', async () => {
  const opened = [];
  const h = harness({ collapsedAgents: ['claude'] }, async (url) => opened.push(url));
  h.state.agentStatus.claude = { available: false, path: null };
  const tree = h.render();
  installButton(tree, 'claude').props.onClick();
  await Promise.resolve();
  assert.deepEqual(opened, ['https://example.com/claude/install']);
  assert.deepEqual(h.toggles, []);
  const toggle = find(
    tree,
    (node) => node.type === 'button' && node.props['aria-label'] === 'claude (not installed)',
  );
  assert.equal(toggle.props['aria-expanded'], false);
  toggle.props.onClick();
  assert.deepEqual(h.toggles, ['claude']);
});

test('installation-guide failures are shown and a refreshed installation removes the missing action', async () => {
  const h = harness({}, async () => {
    throw new Error('Browser unavailable');
  });
  h.state.agentStatus.claude = { available: false, path: null };
  installButton(h.render(), 'claude').props.onClick();
  await Promise.resolve();
  await Promise.resolve();
  const alert = find(h.render(), (node) => node.props?.role === 'alert');
  assert.match(alert.props.children, /Browser unavailable/);
  h.state.agentStatus.claude = { available: true, path: 'claude' };
  assert.equal(installButton(h.render(), 'claude'), undefined);
});
