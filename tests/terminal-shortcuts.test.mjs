import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalShortcut } from '../src/renderer/terminal-shortcuts.ts';

const options = { multiline: true, copyPaste: true, hasSelection: true };
const key = (value, overrides = {}) => ({
  type: 'keydown',
  key: value,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

test('Mac uses Command copy/paste and never consumes Ctrl+C', () => {
  assert.equal(terminalShortcut(key('c', { metaKey: true }), 'darwin', options), 'copy');
  assert.equal(terminalShortcut(key('v', { metaKey: true }), 'darwin', options), 'paste');
  assert.equal(terminalShortcut(key('c', { ctrlKey: true }), 'darwin', options), null);
});

test('Linux uses Ctrl+Shift for clipboard, leaving Ctrl+C and Ctrl+V to the shell', () => {
  assert.equal(
    terminalShortcut(key('C', { ctrlKey: true, shiftKey: true }), 'linux', options),
    'copy',
  );
  assert.equal(
    terminalShortcut(key('V', { ctrlKey: true, shiftKey: true }), 'linux', options),
    'paste',
  );
  assert.equal(terminalShortcut(key('c', { ctrlKey: true }), 'linux', options), null);
  assert.equal(terminalShortcut(key('v', { ctrlKey: true }), 'linux', options), null);
});

test('POSIX copy gestures without a selection are consumed rather than interrupting the PTY', () => {
  const emptySelection = { ...options, hasSelection: false };
  assert.equal(terminalShortcut(key('c', { metaKey: true }), 'darwin', emptySelection), 'copy');
  assert.equal(
    terminalShortcut(key('C', { ctrlKey: true, shiftKey: true }), 'linux', emptySelection),
    'copy',
  );
});

test('Windows retains optional Ctrl clipboard and selection-free interrupt behavior', () => {
  assert.equal(terminalShortcut(key('c', { ctrlKey: true }), 'win32', options), 'copy');
  assert.equal(
    terminalShortcut(key('c', { ctrlKey: true }), 'win32', { ...options, hasSelection: false }),
    null,
  );
  assert.equal(terminalShortcut(key('v', { ctrlKey: true }), 'win32', options), 'paste');
});

test('disabled settings, keyup and Alt combinations pass through', () => {
  assert.equal(
    terminalShortcut(key('v', { metaKey: true }), 'darwin', { ...options, copyPaste: false }),
    null,
  );
  assert.equal(
    terminalShortcut(key('v', { metaKey: true, altKey: true }), 'darwin', options),
    null,
  );
  assert.equal(
    terminalShortcut(key('v', { metaKey: true, type: 'keyup' }), 'darwin', options),
    null,
  );
  assert.equal(
    terminalShortcut(key('Enter', { shiftKey: true }), 'linux', { ...options, multiline: false }),
    null,
  );
});

test('multiline preserves Shift/Ctrl+Enter and adds Command+Enter on Mac', () => {
  assert.equal(terminalShortcut(key('Enter', { shiftKey: true }), 'linux', options), 'newline');
  assert.equal(terminalShortcut(key('Enter', { ctrlKey: true }), 'win32', options), 'newline');
  assert.equal(terminalShortcut(key('Enter', { metaKey: true }), 'darwin', options), 'newline');
});
