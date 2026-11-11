import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import test from 'node:test';

test('session grip keyboard/menu/drag controls do not bubble into project activation', async () => {
  const source = await readFile(
    new URL('../src/renderer/components/SessionOrderControls.tsx', import.meta.url),
    'utf8',
  );
  const { code } = await transform(source, { loader: 'tsx', jsx: 'automatic', format: 'cjs' });
  const require = createRequire(import.meta.url);
  const module = { exports: {} };
  let menu = null;
  new Function('require', 'module', 'exports', 'window', code)(
    (id) => {
      if (id === 'react')
        return {
          useEffect() {},
          useState: () => [
            menu,
            (next) => {
              menu = next;
            },
          ],
        };
      if (id === './ActionIcon') return { ActionIcon: 'ActionIcon' };
      return require(id);
    },
    module,
    module.exports,
    { addEventListener() {}, removeEventListener() {} },
  );
  const moves = [];
  let finished = 0;
  const render = (disabled = false) =>
    module.exports.SessionOrderControls({
      rowKey: 'claude:two',
      scope: 'claude:/repo',
      label: 'Two',
      disabled,
      previous: 'claude:one',
      next: 'claude:three',
      onMove: async (...args) => moves.push(args),
      onDragFinished: () => finished++,
    });
  const nodes = (tree) =>
    !tree || typeof tree !== 'object'
      ? []
      : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  const grip = () =>
    nodes(render()).find((node) => node.props?.className === 'session-order-handle');
  const event = () => ({
    key: 'ArrowUp',
    altKey: true,
    stopped: false,
    prevented: false,
    stopPropagation() {
      this.stopped = true;
    },
    preventDefault() {
      this.prevented = true;
    },
    dataTransfer: {
      setData(...args) {
        this.data = args;
      },
    },
  });
  const key = event();
  grip().props.onKeyDown(key);
  assert.equal(key.stopped, true);
  assert.equal(key.prevented, true);
  assert.deepEqual(moves, [['claude:two', 'claude:one', 'before']]);
  const drag = event();
  grip().props.onDragStart(drag);
  assert.deepEqual(module.exports.activeSessionDrag, { scope: 'claude:/repo', key: 'claude:two' });
  assert.equal(drag.stopped, true);
  grip().props.onDragEnd(event());
  assert.equal(module.exports.activeSessionDrag, null);
  assert.equal(finished, 1);
  grip().props.onContextMenu({ ...event(), clientX: 10, clientY: 20 });
  nodes(render())
    .find((node) => node.props?.children === 'Move down')
    .props.onClick();
  assert.deepEqual(moves.at(-1), ['claude:two', 'claude:three', 'after']);
  const disabled = nodes(render(true)).find(
    (node) => node.props?.className === 'session-order-handle',
  );
  assert.equal(disabled.props.draggable, false);
  disabled.props.onKeyDown(event());
  assert.equal(moves.length, 2);
});
