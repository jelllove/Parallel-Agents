import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';

test('window-all-closed accepts no event argument and keeps the tray app running', async () => {
  const app = new EventEmitter();
  let quitCalls = 0;
  app.whenReady = () => new Promise(() => {});
  app.quit = () => {
    quitCalls++;
  };
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'cjs' });
  const require = createRequire(import.meta.url);
  new Function('require', code)((id) => {
    if (id === 'electron') return { app };
    if (id.startsWith('./')) return {};
    return require(id);
  });
  assert.equal(app.listenerCount('window-all-closed'), 1);
  assert.doesNotThrow(() => app.emit('window-all-closed'));
  assert.equal(quitCalls, 0);
});

async function windowHarness(platform) {
  const app = new EventEmitter();
  app.whenReady = () => new Promise(() => {});
  const windows = [];
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = { setWindowOpenHandler() {} };
      windows.push(this);
    }
    loadFile() {}
  }
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const { code } = await transform(`${source}\nexport { createWindow };`, {
    loader: 'ts',
    format: 'cjs',
  });
  const require = createRequire(import.meta.url);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', '__dirname', code)(
    (id) => {
      if (id === 'electron') return { app, BrowserWindow };
      if (id === './window-titlebar.ts') return require('../src/main/window-titlebar.ts');
      if (id === './ipc.ts') return { registerIpc() {} };
      if (id.startsWith('./')) return {};
      return require(id);
    },
    module,
    module.exports,
    { platform, env: {} },
    new URL('../out/main', import.meta.url).pathname,
  );
  await module.exports.createWindow();
  return windows[0];
}

test('Windows shares the content title row with native caption buttons without disabling its frame or sandbox', async () => {
  const win = await windowHarness('win32');
  assert.equal(win.options.titleBarStyle, 'hidden');
  assert.deepEqual(win.options.titleBarOverlay, {
    color: '#2d2d30',
    symbolColor: '#ffffff',
    height: 36,
  });
  assert.notEqual(win.options.frame, false);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
});

test('macOS and Linux retain their existing native title bars', async () => {
  for (const platform of ['darwin', 'linux']) {
    const win = await windowHarness(platform);
    assert.equal(win.options.titleBarStyle, undefined);
    assert.equal(win.options.titleBarOverlay, undefined);
  }
});

async function themeHarness(platform) {
  const handlers = new Map();
  const overlays = [];
  let theme = 'dark';
  let writeError;
  const win = {
    once() {},
    setTitleBarOverlay: (overlay) => overlays.push(overlay),
  };
  const source = await readFile(new URL('../src/main/ipc.ts', import.meta.url), 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'cjs' });
  const require = createRequire(import.meta.url);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', code)(
    (id) => {
      if (id === 'electron')
        return { ipcMain: { handle: (name, handler) => handlers.set(name, handler) } };
      if (id === './config.ts')
        return {
          getTheme: async () => theme,
          setTheme: async (value) => {
            if (writeError) throw writeError;
            theme = value;
          },
        };
      if (id === './window-titlebar.ts') return require('../src/main/window-titlebar.ts');
      if (id === './pty-manager.ts') return { ptyManager: { attachWindow() {} } };
      if (id === './git.ts') return { attachWindow() {} };
      if (id.startsWith('.')) return {};
      return require(id);
    },
    module,
    module.exports,
    { platform },
  );
  module.exports.registerIpc(win, { subscribe: () => () => {} });
  return {
    overlays,
    getTheme: () => handlers.get('config:getTheme')(),
    setTheme: (value) => handlers.get('config:setTheme')({}, value),
    failWrites: () => {
      writeError = new Error('Config write failed');
    },
  };
}

test('Windows native caption colors track loaded and saved application themes', async () => {
  const h = await themeHarness('win32');
  assert.equal(await h.getTheme(), 'dark');
  assert.deepEqual(h.overlays.at(-1), {
    color: '#2d2d30',
    symbolColor: '#ffffff',
    height: 36,
  });
  await h.setTheme('light');
  assert.deepEqual(h.overlays.at(-1), {
    color: '#ececec',
    symbolColor: '#1f1f1f',
    height: 36,
  });
  h.failWrites();
  await assert.rejects(h.setTheme('dark'), /Config write failed/);
  assert.equal(h.overlays.length, 2, 'failed theme writes must not recolor the native controls');
});

test('theme changes on macOS and Linux do not invoke Windows overlay APIs', async () => {
  for (const platform of ['darwin', 'linux']) {
    const h = await themeHarness(platform);
    await h.getTheme();
    await h.setTheme('light');
    assert.deepEqual(h.overlays, []);
  }
});
