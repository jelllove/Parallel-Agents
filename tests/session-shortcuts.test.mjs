import assert from 'node:assert/strict';
import test from 'node:test';
import { nextSessionTab } from '../src/renderer/store/tab-state.ts';
import {
  handleSessionTabShortcut,
  handleSessionCloseShortcut,
} from '../src/renderer/session-shortcuts.ts';

test('browser close shortcuts request the active tab only, never Ctrl+T or an underlying modal tab', () => {
  const closed = [];
  let consumed = 0;
  const event = {
    key: 'w',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    preventDefault() {
      consumed++;
    },
    stopPropagation() {},
  };
  const run = (patch = {}, platform = 'win32', modal = false, active = 'one') =>
    handleSessionCloseShortcut(
      { ...event, ...patch },
      platform,
      ['one'],
      active,
      (id) => closed.push(id),
      modal,
    );
  run();
  run({ key: 'W', ctrlKey: false, metaKey: true }, 'darwin');
  assert.deepEqual(closed, ['one', 'one']);
  for (const patch of [
    { key: 't' },
    { altKey: true },
    { shiftKey: true },
    { metaKey: true },
    { ctrlKey: false },
    { repeat: true },
    { isComposing: true },
  ])
    run(patch);
  run({}, 'win32', true);
  run({}, 'win32', false, null);
  run({}, 'win32', false, 'missing');
  assert.deepEqual(closed, ['one', 'one']);
  assert.ok(consumed >= 2);
});

test('Ctrl+Tab order wraps forward and backward without modifying tabs', () => {
  const tabs = ['one', 'two', 'three'];
  assert.equal(nextSessionTab(tabs, 'one'), 'two');
  assert.equal(nextSessionTab(tabs, 'three'), 'one');
  assert.equal(nextSessionTab(tabs, 'one', true), 'three');
  assert.equal(nextSessionTab(tabs, 'three', true), 'two');
  assert.deepEqual(tabs, ['one', 'two', 'three']);
});

test('tab cycling handles empty, single, and missing active tabs', () => {
  assert.equal(nextSessionTab([], null), null);
  assert.equal(nextSessionTab(['one'], 'one'), 'one');
  assert.equal(nextSessionTab(['one', 'two'], null), 'one');
  assert.equal(nextSessionTab(['one', 'two'], 'missing', true), 'two');
});

test('Ctrl+Tab is consumed before terminal input and ignored during modal confirmation', () => {
  let prevented = 0;
  let stopped = 0;
  const active = [];
  const event = {
    key: 'Tab',
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: () => prevented++,
    stopPropagation: () => stopped++,
  };
  handleSessionTabShortcut(event, ['one', 'two'], 'one', (id) => active.push(id), false);
  assert.deepEqual(active, ['two']);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  handleSessionTabShortcut(event, ['one', 'two'], 'one', (id) => active.push(id), true);
  handleSessionTabShortcut(
    { ...event, ctrlKey: false },
    ['one', 'two'],
    'one',
    (id) => active.push(id),
    false,
  );
  assert.deepEqual(active, ['two']);
  assert.equal(prevented, 1);
});
