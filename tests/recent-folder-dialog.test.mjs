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
  workspace = {},
  agent = 'codex',
} = {}) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let closed = 0;
  const saves = [];
  const react = {
    useCallback: (callback) => callback,
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
    useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },
    useEffect(effect) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = {};
        effects.push(() => {
          slots[index].cleanup = effect();
        });
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
    (id) => {
      if (id === 'react') return react;
      if (id === '../store/app-store') return { useAppStore: (selector) => selector(state) };
      if (id === '../icons/iconResolver') return { folderIconUrl: () => 'folder.svg' };
      if (id === './ActionIcon') return { ActionIcon: 'ActionIcon' };
      return require(id);
    },
    module,
    module.exports,
    {
      api: {
        workspace: {
          getMode: async () => 'folder',
          setMode: async (mode) => {
            saves.push(mode);
          },
          getRecentFolders: async () => {
            if (failure) throw failure;
            return folders;
          },
          ...workspace,
        },
      },
    },
  );
  const render = () => {
    cursor = 0;
    effects = [];
    const tree = module.exports.NewProjectDialog({
      agent,
      onClose: () => {
        closed++;
      },
    });
    effects.forEach((effect) => effect());
    return tree;
  };
  render();
  await new Promise((resolve) => setImmediate(resolve));
  return {
    render,
    saves,
    closed: () => closed,
    unmount: () => slots.forEach((slot) => slot.cleanup?.()),
  };
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

test('same dialog shows all saved paths with folder icons, no search box, and selects without submitting', async () => {
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
  assert.equal(
    nodes(tree, (node) => node.type === 'input' && node.props.type === 'search').length,
    0,
  );
  for (const button of buttons(tree)) {
    assert.equal(nodes(button, (node) => node.type === 'img' && node.props.alt === '').length, 1);
  }
  assert.equal(buttons(tree)[1].props.title, 'C:\\other');
});

test('worktree selection updates generated target but preserves an explicitly edited target', async () => {
  const h = await harness();
  let tree = h.render();
  await nodes(tree, (node) => node.type === 'select')[0].props.onChange({
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

test('workspace options have distinct icons and launch configuration has a settings icon', async () => {
  const tree = (await harness()).render();
  const options = nodes(tree, (node) => node.type === 'option' && node.props.value);
  assert.match(options.find((node) => node.props.value === 'folder').props.children, /^📂 /u);
  assert.match(options.find((node) => node.props.value === 'worktree').props.children, /^🌿 /u);
  assert.equal(
    nodes(tree, (node) => node.type === 'ActionIcon' && node.props.name === 'settings').length,
    1,
  );
});

test('workspace mode loads globally and persists selection even when the dialog is cancelled', async () => {
  let saved = 'worktree';
  const workspace = {
    getMode: async () => saved,
    setMode: async (mode) => {
      saved = mode;
    },
  };
  const h = await harness({ workspace });
  assert.equal(nodes(h.render(), (node) => node.type === 'select')[0].props.value, 'worktree');
  await nodes(h.render(), (node) => node.type === 'select')[0].props.onChange({
    target: { value: 'folder' },
  });
  nodes(
    h.render(),
    (node) => node.type === 'button' && node.props.children === 'Cancel',
  )[0].props.onClick();
  assert.equal(h.closed(), 1);
  const reopened = await harness({ workspace, agent: 'claude' });
  assert.equal(nodes(reopened.render(), (node) => node.type === 'select')[0].props.value, 'folder');
});

test('workspace mode write failures preserve the previous selection and remain visible', async () => {
  const h = await harness({
    workspace: {
      setMode: async () => {
        throw new Error('disk full');
      },
    },
  });
  await nodes(h.render(), (node) => node.type === 'select')[0].props.onChange({
    target: { value: 'worktree' },
  });
  assert.equal(nodes(h.render(), (node) => node.type === 'select')[0].props.value, 'folder');
  assert.ok(
    nodes(h.render(), (node) => node.props.role === 'alert').some((node) =>
      /disk full/.test(node.props.children),
    ),
  );
});

test('workspace mode load failure prevents submission and offers retry', async () => {
  let attempts = 0;
  let submitted = false;
  const h = await harness({
    workspace: {
      getMode: async () => {
        if (++attempts === 1) throw new Error('cannot read mode');
        return 'worktree';
      },
    },
    createProject: async () => {
      submitted = true;
    },
  });
  assert.equal(nodes(h.render(), (node) => node.type === 'select')[0].props.disabled, true);
  await nodes(h.render(), (node) => node.type === 'form')[0].props.onSubmit({
    preventDefault() {},
  });
  assert.equal(submitted, false);
  await nodes(
    h.render(),
    (node) => node.type === 'button' && node.props.children === 'Retry workspace mode',
  )[0].props.onClick();
  assert.equal(nodes(h.render(), (node) => node.type === 'select')[0].props.value, 'worktree');
});
test('history loading failure is visible while manual project input remains usable', async () => {
  const h = await harness({ failure: new Error('Malformed preferences') });
  const tree = h.render();
  const alert = nodes(tree, (node) => node.props.role === 'alert')[0];
  assert.match(alert.props.children, /Malformed preferences/);
  baseInput(tree).props.onChange({ target: { value: 'C:\\manual' } });
  assert.equal(baseInput(h.render()).props.value, 'C:\\manual');
});

test('pending mode saves prevent duplicate writes and submission with the old mode', async () => {
  const pending = Promise.withResolvers();
  let saves = 0;
  let submitted = false;
  const h = await harness({
    workspace: {
      setMode: async () => {
        saves++;
        await pending.promise;
      },
    },
    createProject: async () => {
      submitted = true;
    },
  });
  const select = nodes(h.render(), (node) => node.type === 'select')[0];
  const saving = select.props.onChange({ target: { value: 'worktree' } });
  await select.props.onChange({ target: { value: 'worktree' } });
  assert.equal(saves, 1);
  assert.equal(nodes(h.render(), (node) => node.type === 'select')[0].props.disabled, true);
  await nodes(h.render(), (node) => node.type === 'form')[0].props.onSubmit({
    preventDefault() {},
  });
  assert.equal(submitted, false);
  pending.resolve();
  await saving;
  assert.equal(nodes(h.render(), (node) => node.type === 'select')[0].props.value, 'worktree');
});

test('closing during the initial workspace read ignores its late response', async () => {
  const pending = Promise.withResolvers();
  const h = await harness({ workspace: { getMode: () => pending.promise } });
  h.unmount();
  pending.resolve('worktree');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nodes(h.render(), (node) => node.type === 'select')[0].props.value, '');
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
