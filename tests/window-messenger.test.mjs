import assert from 'node:assert/strict';
import test from 'node:test';

import { sendToWindow } from '../src/main/window-messenger.ts';

test('does not send IPC after the browser window is destroyed', () => {
  let sends = 0;
  const window = {
    isDestroyed: () => true,
    webContents: {
      isDestroyed: () => false,
      send: () => {
        sends += 1;
      },
    },
  };

  assert.doesNotThrow(() => sendToWindow(window, 'pty:exit', 'project', 0));
  assert.equal(sends, 0);
});

test('does not send IPC after web contents are destroyed', () => {
  let sends = 0;
  const window = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => true,
      send: () => {
        sends += 1;
      },
    },
  };

  assert.doesNotThrow(() => sendToWindow(window, 'pty:data', 'project', 'output'));
  assert.equal(sends, 0);
});

test('sends IPC while the browser window is alive', () => {
  const messages = [];
  const window = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (...args) => messages.push(args),
    },
  };

  sendToWindow(window, 'pty:data', 'project', 'output');

  assert.deepEqual(messages, [['pty:data', 'project', 'output']]);
});
