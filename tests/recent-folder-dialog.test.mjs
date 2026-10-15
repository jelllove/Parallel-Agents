import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { transform } from 'esbuild';

const require = createRequire(import.meta.url);
async function harness({
  folders = ['C:\\repo', 'C:\\other'],
  failure,
  createProject = async () => {},
} = {}) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let closed = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [
        slots[index].value,
        (value) => {
          slots[index].value = value;
        },
      ];
    },
    useRef() {
      const index = cursor++;
      slots[index] ??= { current: { showModal() {} } };
      return slots[index];
    },
    useEffect(effect) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = {};
        effects.push(effect);
      }
    },
  };
  const { code } = await transform(
    await readFile(
      new URL('../src/renderer/components/NewProjectDialog.tsx', import.meta.url),
      'utf8',
    ),
    { loader: 'tsx', format: 'cjs', jsx: 'automatic' },
  );
  const module = { exports: {} };
  const state = { createProject, agents: [{ id: 'codex', displayName: 'Codex' }] };
  new Function('require', 'module', 'exports', 'window', code)(
    (id) =>
      id === 'react'
        ? react
        : id === '../store/app-store'
          ? { useAppStore: (selector) => selector(state) }
          : require(id),
    module,
    module.exports,
    {
      api: {
        workspace: {
          getRecentFolders: async () => {
            if (failure) throw failure;
            return folders;
          },
        },
      },
    },
  );
  const render = () => {
    cursor = 0;
    effects = [];
    const tree = module.exports.NewProjectDialog({
      agent: 'codex',
      onClose: () => {
        closed++;
      },
    });
    effects.forEach((effect) => effect());
    return tree;
  };
  render();
  await new Promise((resolve) => setImmediate(resolve));
  return { render, closed: () => closed };
}

function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...[tree.props?.children].flat(Infinity).flatMap((child) => nodes(child, predicate)),
  ];
}
const buttons = (tree) =>
  nodes(
    tree,
    (node) => node.type === 'button' && node.props.className?.startsWith('recent-folder'),
  );
const baseInput = (tree) => nodes(tree, (node) => node.type === 'input' && node.props.required)[0];

test('same dialog shows all saved paths, filters them and selects without submitting', async () => {
  let submissions = 0;
  const h = await harness({
    createProject: async () => {
      submissions++;
    },
  });
  let tree = h.render();
  assert.equal(buttons(tree).length, 2);
  assert.equal(baseInput(tree).props.value, '');
  buttons(tree)[0].props.onClick();
  tree = h.render();
  assert.equal(baseInput(tree).props.value, 'C:\\repo');
  assert.equal(buttons(tree)[0].props['aria-pressed'], true);
  assert.equal(submissions, 0);
  nodes(tree, (node) => node.props['aria-label'] === 'Filter recent folders')[0].props.onChange({
    target: { value: 'OTHER' },
  });
  assert.equal(buttons(h.render()).length, 1);
  assert.equal(buttons(h.render())[0].props.title, 'C:\\other');
});

test('worktree selection updates generated target but preserves an explicitly edited target', async () => {
  const h = await harness();
  let tree = h.render();
  nodes(tree, (node) => node.type === 'select')[0].props.onChange({
    target: { value: 'worktree' },
  });
  tree = h.render();
  const inputs = nodes(tree, (node) => node.type === 'input' && node.props.required);
  inputs[1].props.onChange({ target: { value: 'feature/task' } });
  tree = h.render();
  buttons(tree)[0].props.onClick();
  tree = h.render();
  assert.equal(
    nodes(tree, (node) => node.type === 'input' && node.props.required)[3].props.value,
    'C:\\repo.worktrees\\feature-task',
  );
  nodes(tree, (node) => node.type === 'input' && node.props.required)[3].props.onChange({
    target: { value: 'C:\\custom' },
  });
  tree = h.render();
  buttons(tree)[1].props.onClick();
  assert.equal(
    nodes(h.render(), (node) => node.type === 'input' && node.props.required)[3].props.value,
    'C:\\custom',
  );
});

test('history loading failure is visible while manual project input remains usable', async () => {
  const h = await harness({ failure: new Error('Malformed preferences') });
  const tree = h.render();
  const alert = nodes(tree, (node) => node.props.role === 'alert')[0];
  assert.match(alert.props.children, /Malformed preferences/);
  baseInput(tree).props.onChange({ target: { value: 'C:\\manual' } });
  assert.equal(baseInput(h.render()).props.value, 'C:\\manual');
});

test('failed folder open keeps the dialog and current path, with explicit error', async () => {
  const h = await harness({
    createProject: async () => {
      throw new Error('Directory is missing');
    },
  });
  buttons(h.render())[0].props.onClick();
  await nodes(h.render(), (node) => node.type === 'form')[0].props.onSubmit({
    preventDefault() {},
  });
  assert.equal(h.closed(), 0);
  assert.equal(baseInput(h.render()).props.value, 'C:\\repo');
  assert.ok(
    nodes(h.render(), (node) => node.props.role === 'alert').some((node) =>
      /Directory is missing/.test(node.props.children),
    ),
  );
});
