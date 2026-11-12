import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import test from 'node:test';
import { terminalShortcut } from '../src/renderer/terminal-shortcuts.ts';
const require = createRequire(import.meta.url);

async function harness(platform = 'win32') {
  const writes = [];
  const pasted = [];
  const output = [];
  const slots = [];
  let cursor = 0;
  let effects = [];
  let keyHandler;
  let dataListener;
  const state = {
    theme: 'dark',
    fontSize: 14,
    fontFamily: 'default',
    fontBold: false,
    terminalMultilineEnter: true,
    terminalCopyPaste: true,
    tabSessionId: {},
    managedTabs: {},
    consumePendingCommand() {},
  };
  let text = 'copied text';
  let read = async () => text;
  let disposed = false;
  const react = {
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: initial };
      return [slots[i].value, (value) => (slots[i].value = value)];
    },
    useRef(initial) {
      const i = cursor++;
      slots[i] ??= {
        current: i === 0 ? { getBoundingClientRect: () => ({ width: 800, height: 600 }) } : initial,
      };
      return slots[i];
    },
    useEffect(effect, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((value, n) => !Object.is(value, slots[i].deps[n])))
        effects.push(() => {
          slots[i]?.cleanup?.();
          slots[i] = { deps, cleanup: effect() };
        });
    },
  };
  const useAppStore = Object.assign((select) => select(state), { getState: () => state });
  const { code } = await transform(
    await readFile(new URL('../src/renderer/components/TerminalPane.tsx', import.meta.url), 'utf8'),
    { loader: 'tsx', format: 'cjs', jsx: 'automatic' },
  );
  const module = { exports: {} };
  new Function(
    'require',
    'module',
    'exports',
    'window',
    'navigator',
    'ResizeObserver',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    code,
  )(
    (id) => {
      if (id === 'react') return react;
      if (id === '../store/app-store') return { useAppStore };
      if (id === '../terminal-shortcuts') return { terminalShortcut };
      if (id === '../terminal-layout') return require('../src/renderer/terminal-layout.ts');
      if (id === '../../shared/typography') return { resolveFontFamily: () => 'monospace' };
      if (id === '@xterm/xterm')
        return {
          Terminal: class {
            constructor() {
              this.cols = 80;
              this.rows = 24;
              this.options = {};
            }
            open() {}
            loadAddon() {}
            focus() {}
            write(text) {
              output.push(text);
            }
            hasSelection() {
              return false;
            }
            attachCustomKeyEventHandler(handler) {
              keyHandler = handler;
            }
            onData(listener) {
              dataListener = listener;
            }
            paste(value) {
              assert.equal(disposed, false);
              pasted.push(value);
              dataListener(value);
            }
            dispose() {
              disposed = true;
            }
          },
        };
      if (id === '@xterm/addon-fit')
        return {
          FitAddon: class {
            fit() {}
          },
        };
      if (id === '@xterm/addon-web-links') return { WebLinksAddon: class {} };
      return require(id);
    },
    module,
    module.exports,
    {
      api: {
        platform,
        pty: {
          spawn: async () => {},
          write: (id, value) => writes.push([id, value]),
          resize: async () => {},
          onData: () => () => {},
          onExit: () => () => {},
        },
      },
    },
    { clipboard: { readText: () => read() } },
    class {
      observe() {}
      disconnect() {}
    },
    (callback) => {
      queueMicrotask(callback);
      return 1;
    },
    () => {},
  );
  const render = () => {
    cursor = 0;
    effects = [];
    const tree = module.exports.TerminalPane({
      terminalKey: 'fixture::agent',
      cwd: '/fixture',
      visible: true,
    });
    effects.forEach((effect) => effect());
    return tree;
  };
  render();
  return {
    writes,
    pasted,
    output,
    state,
    render,
    text: (value) => {
      text = value;
    },
    read: (callback) => {
      read = callback;
    },
    unmount: () => slots.forEach((slot) => slot.cleanup?.()),
    press(overrides = {}) {
      const event = {
        type: 'keydown',
        key: 'v',
        ctrlKey: platform !== 'darwin',
        metaKey: platform === 'darwin',
        altKey: false,
        shiftKey: platform === 'linux',
        defaultPrevented: false,
        stopped: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {
          this.stopped = true;
        },
        ...overrides,
      };
      const result = keyHandler(event);
      // Returning false from xterm's custom handler skips xterm key processing, not the browser default paste.
      if (!event.defaultPrevented && event.type === 'keydown' && !event.altKey) dataListener(text);
      return { event, result };
    },
  };
}

for (const platform of ['win32', 'darwin', 'linux'])
  test(`${platform} clipboard shortcut cancels native default and delivers one xterm paste`, async () => {
    const h = await harness(platform);
    const { event, result } = h.press();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(result, false);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, true);
    assert.deepEqual(h.writes, [['fixture::agent', 'copied text']]);
    assert.deepEqual(h.pasted, ['copied text']);
    h.unmount();
  });
test('Alt+V passes through and disabling custom clipboard leaves one native paste', async () => {
  const h = await harness();
  const alt = h.press({ ctrlKey: false, altKey: true });
  assert.equal(alt.result, true);
  assert.equal(alt.event.defaultPrevented, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.writes, []);
  h.state.terminalCopyPaste = false;
  h.render();
  h.press();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.writes, [['fixture::agent', 'copied text']]);
  h.unmount();
});
test('clipboard read failure is reported without a PTY write or unhandled rejection', async () => {
  const h = await harness();
  h.read(async () => {
    throw new Error('Clipboard permission denied');
  });
  const { event } = h.press();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(h.writes, []);
  assert.match(h.output.join(''), /Clipboard paste failed: Clipboard permission denied/);
  h.unmount();
});
test('context-menu paste uses xterm paste once and empty text sends nothing', async () => {
  const h = await harness();
  h.text('line one\nline two');
  h.render().props.onContextMenu({ preventDefault() {}, clientX: 1, clientY: 1 });
  const find = (tree, text) => {
    if (!tree || typeof tree !== 'object') return undefined;
    if (tree.props?.children === text) return tree;
    return [tree.props?.children]
      .flat(Infinity)
      .map((child) => find(child, text))
      .find(Boolean);
  };
  await find(h.render(), 'Paste').props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.pasted, ['line one\nline two']);
  assert.equal(h.writes.length, 1);
  h.text('');
  h.press();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.writes.length, 1);
  h.unmount();
});
test('closing a terminal while clipboard permission/read is pending cannot paste into its disposed instance', async () => {
  const h = await harness();
  const pending = Promise.withResolvers();
  h.read(() => pending.promise);
  h.press();
  h.unmount();
  pending.resolve('late clipboard');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.writes, []);
});
