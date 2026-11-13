import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import test from 'node:test';

const require = createRequire(import.meta.url);
const nodes = (tree) =>
  !tree || typeof tree !== 'object'
    ? []
    : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];

async function fixture() {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const react = {
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [
        slots[i].value,
        (next) => {
          slots[i].value = typeof next === 'function' ? next(slots[i].value) : next;
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
      if (!slots[i] || deps.some((value, n) => value !== slots[i].deps[n])) {
        effects.push(() => {
          slots[i]?.cleanup?.();
          slots[i] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const requests = [];
  const cancelled = [];
  const queued = [];
  const { code } = await transform(
    await readFile(
      new URL('../src/renderer/components/SessionDeleteDialog.tsx', import.meta.url),
      'utf8',
    ),
    { loader: 'tsx', jsx: 'automatic', format: 'cjs' },
  );
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', code)(
    (id) => {
      if (id === 'react') return react;
      if (id === './ConfirmDialog') return { ConfirmDialog: 'ConfirmDialog' };
      if (id === '../../shared/project-tree') return require('../src/shared/project-tree.ts');
      if (id === '../store/session-deletion')
        return {
          queueReviewedSessionDeletion(preview, selected) {
            queued.push({ preview, selected });
            return 1;
          },
        };
      return require(id);
    },
    module,
    module.exports,
    {
      api: {
        sessions: {
          previewDeletion(...args) {
            const pending = Promise.withResolvers();
            requests.push({ args, ...pending });
            return pending.promise;
          },
          async cancelDeletion(token) {
            cancelled.push(token);
          },
        },
      },
    },
  );
  const target = {
    project: {
      id: 'claude:wt',
      realPath: '/wt',
      worktree: { parentPath: '/base', branch: 'feat/test' },
    },
    session: { id: 'a', agent: 'claude', title: 'A', cwd: '/wt' },
  };
  const session = {
    projectId: 'claude:wt',
    sessionId: 'a',
    agent: 'claude',
    title: 'A',
    cwd: '/wt',
  };
  const targets = [target];
  let accepted = 0;
  const render = () => {
    cursor = 0;
    effects = [];
    const tree = module.exports.SessionDeleteDialog({
      targets,
      onAccepted: () => accepted++,
      onCancel() {},
    });
    effects.forEach((effect) => effect());
    return tree;
  };
  const checkbox = () => nodes(render().props.message).find((node) => node.type === 'input');
  return {
    render,
    checkbox,
    requests,
    cancelled,
    queued,
    session,
    accepted: () => accepted,
    unmount: () => slots.forEach((slot) => slot.cleanup?.()),
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('deletion opens with captured rows and a history-only request; cleanup requires acknowledgement', async () => {
  const f = await fixture();
  const tree = f.render();
  assert.ok(nodes(tree.props.message).some((node) => node.type === 'li'));
  assert.deepEqual(f.requests[0].args, [[{ projectId: 'claude:wt', sessionId: 'a' }], false]);
  assert.equal(f.checkbox().props.disabled, true);
  f.requests[0].resolve({ token: 'history', sessions: [f.session], worktrees: [] });
  await settle();
  f.render().props.onArmedChange(true);
  assert.equal(f.checkbox().props.disabled, false);
  f.checkbox().props.onChange({ target: { checked: true } });
  assert.equal(f.render().props.confirmDisabled, true);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].args[1], true);
  f.requests[1].resolve({
    token: 'cleanup',
    sessions: [f.session],
    worktrees: [{ key: '/wt', path: '/wt', branch: 'feat/test', additional: [] }],
  });
  await settle();
  assert.equal(f.render().props.armed, true);
  assert.equal(f.checkbox().props.checked, true);
  assert.equal(f.render().props.confirmDisabled, false);
  assert.deepEqual(f.cancelled, ['history']);
  f.render().props.onArmedChange(false);
  assert.equal(f.checkbox().props.disabled, true);
  assert.equal(
    f.checkbox().props.checked,
    true,
    'temporarily disarming does not discard cleanup choice',
  );
  f.render().props.onArmedChange(true);
  f.render().props.onConfirm();
  assert.deepEqual(f.queued[0].selected, ['/wt']);
  assert.equal(f.accepted(), 1);
  f.unmount();
  assert.deepEqual(f.cancelled, ['history'], 'accepted review belongs to the background operation');
});

test('additional histories are displayed before a second explicit cleanup selection', async () => {
  const f = await fixture();
  f.render();
  f.requests[0].resolve({ token: 'history', sessions: [f.session], worktrees: [] });
  await settle();
  f.render().props.onArmedChange(true);
  f.checkbox().props.onChange({ target: { checked: true } });
  f.render();
  f.requests[1].resolve({
    token: 'cleanup',
    sessions: [f.session],
    worktrees: [
      {
        key: '/wt',
        path: '/wt',
        branch: 'feat/test',
        additional: [{ ...f.session, sessionId: 'b', title: 'B' }],
      },
    ],
  });
  await settle();
  assert.equal(f.checkbox().props.checked, false);
  assert.equal(f.render().props.armed, true);
  assert.ok(
    nodes(f.render().props.message).some(
      (node) => node.type === 'li' && String(node.props.children).includes('B'),
    ),
  );
  f.checkbox().props.onChange({ target: { checked: true } });
  assert.equal(f.checkbox().props.checked, true);
  assert.equal(f.render().props.armed, true);
  f.unmount();
  assert.deepEqual(f.cancelled, ['history', 'cleanup']);
});

test('cleanup scan failure offers a history-only review without discarding acknowledgement', async () => {
  const f = await fixture();
  f.render();
  f.requests[0].resolve({ token: 'history', sessions: [f.session], worktrees: [] });
  await settle();
  f.render().props.onArmedChange(true);
  f.checkbox().props.onChange({ target: { checked: true } });
  f.render();
  f.requests[1].reject(new Error('Unrelated history unavailable'));
  await settle();
  assert.match(f.render().props.warning, /Unrelated history unavailable/);
  assert.equal(f.render().props.confirmDisabled, true);
  nodes(f.render().props.message)
    .find((node) => node.type === 'button')
    .props.onClick();
  f.render();
  assert.equal(f.requests[2].args[1], false);
  f.requests[2].resolve({ token: 'retry', sessions: [f.session], worktrees: [] });
  await settle();
  assert.equal(f.render().props.armed, true);
  assert.equal(f.render().props.confirmDisabled, false);
  f.render().props.onConfirm();
  assert.deepEqual(f.queued[0].selected, []);
});

test('late cleanup reviews are cancelled after dismissal', async () => {
  const f = await fixture();
  f.render();
  f.requests[0].resolve({ token: 'history', sessions: [f.session], worktrees: [] });
  await settle();
  f.render().props.onArmedChange(true);
  f.checkbox().props.onChange({ target: { checked: true } });
  f.render();
  f.unmount();
  f.requests[1].resolve({ token: 'late', sessions: [f.session], worktrees: [] });
  await settle();
  assert.deepEqual(f.cancelled, ['history', 'late']);
  assert.deepEqual(f.queued, []);
});
