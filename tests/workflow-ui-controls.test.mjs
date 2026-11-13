import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { transform } from 'esbuild';
const require = createRequire(import.meta.url);
const tick = () => new Promise((resolve) => setImmediate(resolve));
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...[tree.props?.children, tree.props?.message]
      .flat(Infinity)
      .flatMap((child) => nodes(child, predicate)),
  ];
}
async function harness(name, props, { api = {}, queue = () => 1, background = {} } = {}) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let focused = 0;
  const listeners = new Map();
  const react = {
    useId: () => 'fixture-dropdown',
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: initial };
      return [
        slots[i].value,
        (value) => {
          slots[i].value = typeof value === 'function' ? value(slots[i].value) : value;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      slots[i] ??= { current: initial };
      return slots[i];
    },
    useEffect(effect, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((value, n) => !Object.is(value, slots[i].deps[n]))) {
        effects.push(() => {
          slots[i]?.cleanup?.();
          slots[i] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const { code } = await transform(
    await readFile(new URL(`../src/renderer/components/${name}.tsx`, import.meta.url), 'utf8'),
    { loader: 'tsx', format: 'cjs', jsx: 'automatic' },
  );
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', 'document', code)(
    (id) => {
      if (id === 'react/jsx-runtime') {
        const runtime = require(id);
        const render = (factory) => (type, childProps, key) => {
          if (typeof type !== 'function') return factory(type, childProps, key);
          const element = type(childProps);
          return key === undefined ? element : require('react').cloneElement(element, { key });
        };
        return { ...runtime, jsx: render(runtime.jsx), jsxs: render(runtime.jsxs) };
      }
      if (id === 'react') return react;
      if (id === '../icons/iconResolver') return { folderIconUrl: () => 'folder.svg' };
      if (id === './ConfirmDialog') return { ConfirmDialog: 'ConfirmDialog' };
      if (id === '../../shared/project-tree') return require('../src/shared/project-tree.ts');
      if (id === '../store/session-deletion') return { queueReviewedSessionDeletion: queue };
      if (id === '../store/background-operations')
        return { useBackgroundOperations: (selector) => selector(background) };
      if (id === '../store/app-store') return { useAppStore: {} };
      if (id === '../notice-expiry') return require('../src/renderer/notice-expiry.ts');
      return require(id);
    },
    module,
    module.exports,
    { api },
    {
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
      getElementById: () => ({ scrollIntoView() {} }),
    },
  );
  return {
    render() {
      cursor = 0;
      effects = [];
      const tree = module.exports[name](props);
      for (const node of nodes(tree, (node) => node.ref))
        node.ref.current = {
          focus() {
            focused++;
          },
          contains: () => false,
        };
      effects.forEach((effect) => effect());
      return tree;
    },
    unmount() {
      slots.forEach((slot) => slot.cleanup?.());
    },
    focused: () => focused,
    listeners,
  };
}
function event(key) {
  return {
    key,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
}

test('completed operation cards dismiss after fifteen seconds without any focus API and keep manual Dismiss', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [status, warning] of [
    ['succeeded', false],
    ['succeeded', true],
    ['failed', false],
    ['running', false],
    ['queued', false],
  ]) {
    const operation = { id: 1, title: 'Delete session', status, warning };
    const dismissed = [];
    const background = { operations: [operation], dismiss: (id) => dismissed.push(id) };
    const h = await harness('OperationNotices', {}, { background });
    let tree = h.render();
    const pending = status === 'queued' || status === 'running';
    const dismiss = nodes(
      tree,
      (node) => node.props?.['aria-label'] === 'Dismiss Delete session',
    )[0];
    assert.equal(Boolean(dismiss), !pending);
    t.mock.timers.tick(10000);
    operation.message = 'Updated detail';
    tree = h.render();
    assert.equal(nodes(tree, (node) => node.type === 'section').length, 1);
    t.mock.timers.tick(4999);
    assert.deepEqual(dismissed, []);
    t.mock.timers.tick(1);
    assert.deepEqual(dismissed, pending ? [] : [1]);
    h.unmount();
  }
  const completed = [];
  const operation = { id: 3, title: 'Slow deletion', status: 'running' };
  const transition = await harness(
    'OperationNotices',
    {},
    { background: { operations: [operation], dismiss: (id) => completed.push(id) } },
  );
  transition.render();
  t.mock.timers.tick(30000);
  assert.deepEqual(completed, []);
  operation.status = 'succeeded';
  transition.render();
  t.mock.timers.tick(14999);
  assert.deepEqual(completed, []);
  t.mock.timers.tick(1);
  assert.deepEqual(completed, [3]);
  transition.unmount();
  const dismissed = [];
  const manual = await harness(
    'OperationNotices',
    {},
    {
      background: {
        operations: [{ id: 2, title: 'Manual', status: 'succeeded' }],
        dismiss: (id) => dismissed.push(id),
      },
    },
  );
  nodes(
    manual.render(),
    (node) => node.props?.['aria-label'] === 'Dismiss Manual',
  )[0].props.onClick();
  manual.unmount();
  t.mock.timers.tick(15000);
  assert.deepEqual(dismissed, [2]);
});

test('recent dropdown collapses, navigates with keys, preserves icons/paths and selects without submitting', async () => {
  const selected = [];
  const h = await harness('RecentFolderDropdown', {
    folders: ['C:/base', 'C:/other'],
    value: '',
    disabled: false,
    onSelect: (path) => selected.push(path),
  });
  let tree = h.render();
  assert.equal(nodes(tree, (n) => n.props.role === 'listbox').length, 0);
  const trigger = nodes(tree, (n) => n.type === 'button')[0];
  assert.equal(trigger.props.type, 'button');
  trigger.props.onClick();
  tree = h.render();
  let list = nodes(tree, (n) => n.props.role === 'listbox')[0];
  assert.equal(nodes(list, (n) => n.props.role === 'option').length, 2);
  assert.equal(nodes(list, (n) => n.type === 'img' && n.props.alt === '').length, 2);
  const end = event('End');
  list.props.onKeyDown(end);
  assert.equal(end.stopped, true);
  tree = h.render();
  list = nodes(tree, (n) => n.props.role === 'listbox')[0];
  assert.match(list.props['aria-activedescendant'], /-1$/);
  list.props.onKeyDown(event('Enter'));
  tree = h.render();
  assert.deepEqual(selected, ['C:/other']);
  assert.equal(nodes(tree, (n) => n.props.role === 'listbox').length, 0);
  nodes(tree, (n) => n.type === 'button')[0].props.onClick();
  tree = h.render();
  nodes(tree, (n) => n.props.role === 'listbox')[0].props.onKeyDown(event('Escape'));
  assert.equal(nodes(h.render(), (n) => n.props.role === 'listbox').length, 0);
  assert.deepEqual(selected, ['C:/other']);
  h.unmount();
  assert.equal(h.listeners.size, 0);
});

test('worktree deletion review is opt-in, expands only after consent, and cancels without mutation', async () => {
  let accepted = 0;
  let cancelled = 0;
  const queued = [];
  const cancelledTokens = [];
  const a = { projectId: 'claude:wt', sessionId: 'a', agent: 'claude', title: 'A', cwd: 'C:/wt' };
  const b = { ...a, sessionId: 'b', title: 'B' };
  const preview = {
    token: 'preview',
    sessions: [a],
    worktrees: [{ key: 'wt', path: 'C:/wt', branch: 'feat/test', additional: [b] }],
  };
  const targets = [
    {
      project: {
        id: a.projectId,
        realPath: a.cwd,
        worktree: { parentPath: 'C:/base', branch: 'feat/test' },
      },
      session: { id: a.sessionId, agent: a.agent, title: a.title, cwd: a.cwd },
    },
  ];
  const h = await harness(
    'SessionDeleteDialog',
    {
      targets,
      onAccepted() {
        accepted++;
      },
      onCancel() {
        cancelled++;
      },
    },
    {
      api: {
        sessions: {
          previewDeletion: async (_targets, cleanup) =>
            cleanup ? preview : { ...preview, token: 'history', worktrees: [] },
          cancelDeletion: async (token) => cancelledTokens.push(token),
        },
      },
      queue: (...args) => {
        queued.push(args);
        return 1;
      },
    },
  );
  assert.equal(h.render().props.confirmDisabled, true);
  await tick();
  let tree = h.render();
  assert.equal(tree.props.confirmDisabled, false);
  assert.equal(tree.props.typeToConfirm, undefined);
  let option = nodes(tree, (n) => n.type === 'input' && n.props.type === 'checkbox')[0];
  assert.equal(option.props.checked, false);
  assert.equal(
    nodes(tree, (n) => n.props['aria-label'] === 'Sessions to delete')[0].props.children.length,
    1,
  );
  assert.equal(option.props.disabled, true);
  tree.props.onArmedChange(true);
  tree = h.render();
  option = nodes(tree, (n) => n.type === 'input' && n.props.type === 'checkbox')[0];
  const key = tree.key;
  option.props.onChange({ target: { checked: true } });
  h.render();
  await tick();
  tree = h.render();
  assert.equal(tree.key, key, 'cleanup never remounts or resets acknowledgement');
  assert.equal(tree.props.armed, true);
  option = nodes(tree, (n) => n.type === 'input' && n.props.type === 'checkbox')[0];
  assert.equal(option.props.checked, false, 'additional identities are shown before consent');
  option.props.onChange({ target: { checked: true } });
  tree = h.render();
  assert.equal(
    nodes(tree, (n) => n.props['aria-label'] === 'Sessions to delete')[0].props.children.length,
    2,
  );
  nodes(tree, (n) => n.type === 'input')[0].props.onChange({ target: { checked: false } });
  tree = h.render();
  tree.props.onConfirm();
  assert.equal(accepted, 1);
  assert.deepEqual(queued[0][1], []);
  h.unmount();
  assert.deepEqual(cancelledTokens, ['history']);
  cancelledTokens.length = 0;
  const cancel = await harness(
    'SessionDeleteDialog',
    {
      targets,
      onAccepted() {},
      onCancel() {
        cancelled++;
      },
    },
    {
      api: {
        sessions: {
          previewDeletion: async (_targets, cleanup) =>
            cleanup ? preview : { ...preview, token: 'history', worktrees: [] },
          cancelDeletion: async (token) => cancelledTokens.push(token),
        },
      },
    },
  );
  cancel.render();
  await tick();
  cancel.render().props.onCancel();
  cancel.unmount();
  assert.equal(cancelled, 1);
  assert.deepEqual(cancelledTokens, ['history']);
});
