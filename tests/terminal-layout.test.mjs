import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerminalLayout } from '../src/renderer/terminal-layout.ts';
test('terminal layout fits once per frame, skips hidden/unchanged dimensions and cancels disposal', () => {
  let callback,
    visible = true,
    fits = 0,
    cancels = 0;
  const sizes = [];
  const layout = createTerminalLayout({
    frame: (cb) => {
      callback = cb;
      return 1;
    },
    cancel: () => cancels++,
    visible: () => visible,
    fit: () => {
      fits++;
      return { cols: 80, rows: 24 };
    },
    resize: (...size) => sizes.push(size),
  });
  layout.schedule();
  layout.schedule();
  callback();
  assert.equal(fits, 1);
  assert.deepEqual(sizes, [[80, 24]]);
  layout.schedule();
  callback();
  assert.equal(fits, 2);
  assert.equal(sizes.length, 1);
  visible = false;
  layout.schedule();
  assert.equal(fits, 2);
  visible = true;
  layout.schedule();
  layout.dispose();
  callback();
  assert.equal(cancels, 1);
  assert.equal(fits, 2);
});
