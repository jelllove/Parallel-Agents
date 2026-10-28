import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';

const require = createRequire(import.meta.url);
const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const { code } = await transform(await source('src/main/update-controller.ts'), {
  loader: 'ts',
  format: 'cjs',
});
const controllerModule = { exports: {} };
new Function('module', 'exports', code)(controllerModule, controllerModule.exports);
const { UpdateController, UPDATE_CHECK_INTERVAL } = controllerModule.exports;

function setup(options = {}) {
  const updater = new EventEmitter();
  updater.checks = 0;
  updater.installs = [];
  updater.checkForUpdates = async () => {
    updater.checks++;
    updater.emit('update-not-available');
    return {};
  };
  updater.quitAndInstall = (...args) => updater.installs.push(args);
  const controller = new UpdateController({
    updater,
    enabled: true,
    currentVersion: '0.1.9',
    confirmAndInstall: async (install) => {
      install();
      return true;
    },
    ...options,
  });
  return { updater, controller };
}

test('development/source builds never check, download or install', async () => {
  const { updater, controller } = setup({ enabled: false });
  controller.start();
  assert.equal((await controller.check()).state, 'unavailable');
  assert.equal((await controller.install()).state, 'unavailable');
  assert.equal(updater.checks, 0);
  assert.equal(updater.installs.length, 0);
  controller.dispose();
});

test('stable-only automatic download, never install on ordinary quit', async () => {
  const { updater, controller } = setup();
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal((await controller.check()).message, 'You are up to date.');
  assert.equal(updater.installs.length, 0);
  controller.dispose();
});

test('startup and four-hour checks are idempotent and disposable', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { updater, controller } = setup();
  controller.start();
  controller.start();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(updater.checks, 1);
  assert.equal(UPDATE_CHECK_INTERVAL, 4 * 60 * 60 * 1000);
  t.mock.timers.tick(UPDATE_CHECK_INTERVAL);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(updater.checks, 2);
  controller.dispose();
  t.mock.timers.tick(UPDATE_CHECK_INTERVAL);
  assert.equal(updater.checks, 2);
  assert.equal(updater.listenerCount('error'), 0);
});

test('download state/progress reaches ready without restarting and blocks redundant checks', async () => {
  const { updater, controller } = setup();
  let finish;
  updater.checkForUpdates = async () => {
    updater.checks++;
    updater.emit('update-available', { version: '0.2.0' });
    return {
      downloadPromise: new Promise((resolve) => {
        finish = resolve;
      }),
    };
  };
  const statuses = [];
  const unsubscribe = controller.subscribe((status) => statuses.push(status));
  const checking = controller.check();
  await Promise.resolve();
  await controller.check();
  assert.equal(updater.checks, 1);
  updater.emit('download-progress', { percent: 52.5 });
  assert.equal(controller.getStatus().percent, 52.5);
  updater.emit('update-downloaded', { version: '0.2.0' });
  finish([]);
  assert.equal((await checking).state, 'downloaded');
  assert.equal(controller.getStatus().canInstall, true);
  assert.equal(updater.installs.length, 0);
  await controller.check();
  assert.equal(updater.checks, 1);
  assert.deepEqual(
    statuses.map((s) => s.state),
    ['checking', 'available', 'downloading', 'downloaded'],
  );
  const snapshot = controller.getStatus();
  snapshot.state = 'error';
  assert.equal(controller.getStatus().state, 'downloaded');
  unsubscribe();
  controller.dispose();
});

test('check and automatic download failures are surfaced and retryable', async () => {
  const { updater, controller } = setup();
  updater.checkForUpdates = async () => {
    throw new Error('GitHub is unreachable');
  };
  assert.equal((await controller.check()).message, 'GitHub is unreachable');
  updater.checkForUpdates = async () => ({
    downloadPromise: Promise.reject(new Error('Download failed')),
  });
  assert.equal((await controller.check()).message, 'Download failed');
  updater.checkForUpdates = async () => {
    updater.emit('update-not-available');
    return {};
  };
  assert.equal((await controller.check()).state, 'idle');
  controller.dispose();
});

test('install requires ready state and confirmation, and cancellation leaves agents untouched', async () => {
  let confirmations = 0;
  let approve;
  const { updater, controller } = setup({
    confirmAndInstall: async (install) => {
      confirmations++;
      if (
        await new Promise((resolve) => {
          approve = resolve;
        })
      ) {
        install();
        return true;
      }
      return false;
    },
  });
  await controller.install();
  assert.equal(confirmations, 0);
  updater.emit('update-downloaded', { version: '0.2.0' });
  const cancelled = controller.install();
  await controller.install();
  assert.equal(confirmations, 1);
  approve(false);
  assert.equal((await cancelled).state, 'downloaded');
  assert.equal(updater.installs.length, 0);
  const approved = controller.install();
  approve(true);
  assert.equal((await approved).state, 'installing');
  assert.deepEqual(updater.installs, [[false, true]]);
  await controller.install();
  assert.equal(updater.installs.length, 1);
  controller.dispose();
});

test('install errors remain visible and restore normal application quit handling', async () => {
  let recovered = 0;
  const { updater, controller } = setup({
    onInstallError: () => {
      recovered++;
    },
  });
  updater.emit('update-downloaded', { version: '0.2.0' });
  updater.quitAndInstall = () => {
    throw new Error('Installer could not start');
  };
  assert.equal((await controller.install()).message, 'Installer could not start');
  assert.equal(recovered, 1);
  assert.equal(controller.getStatus().canInstall, true);
  updater.quitAndInstall = () => updater.emit('error', new Error('Installer permission denied'));
  assert.equal((await controller.install()).message, 'Installer permission denied');
  assert.equal(recovered, 2);
  controller.dispose();
});

test('confirmation errors are surfaced without attempting installation', async () => {
  const { updater, controller } = setup({
    confirmAndInstall: async () => {
      throw new Error('Confirmation window unavailable');
    },
  });
  updater.emit('update-downloaded', { version: '0.2.0' });
  assert.equal((await controller.install()).state, 'error');
  assert.equal(updater.installs.length, 0);
  controller.dispose();
});

test('preload update API forwards typed operations and removes event subscriptions', async () => {
  const { code } = await transform(await source('src/preload/index.ts'), {
    loader: 'ts',
    format: 'cjs',
  });
  const ipc = new EventEmitter();
  const calls = [];
  ipc.invoke = async (...args) => {
    calls.push(args);
    return { state: 'idle' };
  };
  let api;
  new Function('require', code)((id) => {
    assert.equal(id, 'electron');
    return {
      ipcRenderer: ipc,
      contextBridge: {
        exposeInMainWorld: (_name, value) => {
          api = value;
        },
      },
    };
  });
  await api.updates.getStatus();
  await api.updates.check();
  await api.updates.install();
  assert.deepEqual(calls, [['updates:getStatus'], ['updates:check'], ['updates:install']]);
  let received;
  const unsubscribe = api.updates.onStatus((status) => {
    received = status;
  });
  ipc.emit('updates:status', {}, { state: 'downloaded' });
  assert.equal(received.state, 'downloaded');
  unsubscribe();
  assert.equal(ipc.listenerCount('updates:status'), 0);
});

test('release configuration produces GitHub NSIS update artifacts', async () => {
  const pkg = JSON.parse(await source('package.json'));
  assert.equal(pkg.dependencies['electron-updater'], '6.8.9');
  assert.deepEqual(pkg.build.publish, {
    provider: 'github',
    owner: 'jelllove',
    repo: 'Parallel-Agents',
    releaseType: 'release',
  });
  assert.equal(pkg.build.nsis.differentialPackage, true);
  assert.equal(pkg.build.win.artifactName, 'Parallel-Agents-Setup-${version}.${ext}');
  assert.ok(pkg.build.win.target.some((target) => target.target === 'nsis'));
});

test('CommonJS electron-updater is accessed through its default dynamic import', async () => {
  const updaterModule = await import('electron-updater');
  assert.ok(Object.getOwnPropertyDescriptor(updaterModule.default, 'autoUpdater')?.get);
  assert.match(await source('src/main/index.ts'), /default: electronUpdater/);
});

async function quitHarness({
  tabs = ['Claude agent', 'PowerShell'],
  response = 1,
  rendererFailed = false,
} = {}) {
  const calls = [];
  const app = new EventEmitter();
  app.whenReady = () => new Promise(() => {});
  app.quit = () => calls.push('quit');
  const win = {
    isDestroyed: () => false,
    isMinimized: () => false,
    isVisible: () => true,
    focus() {},
    webContents: {
      executeJavaScript: async () => {
        if (rendererFailed) throw new Error('Renderer unavailable');
        return tabs;
      },
    },
  };
  let confirmation;
  const text = await source('src/main/index.ts');
  const { code } = await transform(
    `${text}\nexport { quitWithConfirm };\nexport function setTestWindow(win) { mainWindow = win; }`,
    {
      loader: 'ts',
      format: 'cjs',
    },
  );
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (id) => {
      if (id === 'electron')
        return {
          app,
          dialog: {
            showMessageBox: async (_win, options) => {
              confirmation = options;
              return { response };
            },
          },
        };
      if (id === './pty-manager.ts')
        return {
          ptyManager: {
            detachWindow: () => calls.push('detach-pty'),
            killAll: () => calls.push('kill-agents'),
          },
        };
      if (id === './git.ts')
        return {
          detachWindow: () => calls.push('detach-git'),
          unwatchAll: () => calls.push('unwatch'),
        };
      if (id.startsWith('./')) return {};
      return require(id);
    },
    module,
    module.exports,
  );
  module.exports.setTestWindow(win);
  return { quit: module.exports.quitWithConfirm, calls, confirmation: () => confirmation };
}

test('real quit confirmation cancels updates without killing PTYs, and approves cleanup before installation', async () => {
  for (const response of [1, 0]) {
    const h = await quitHarness({ response });
    const result = await h.quit(() => h.calls.push('install'));
    assert.equal(result, response === 0);
    assert.match(h.confirmation().detail, /Claude agent/);
    assert.match(h.confirmation().detail, /PowerShell/);
    assert.equal(h.confirmation().defaultId, 1);
    assert.deepEqual(
      h.calls,
      response === 0 ? ['detach-pty', 'detach-git', 'unwatch', 'kill-agents', 'install'] : [],
    );
  }
});

test('updates still require confirmation when tabs are empty or renderer is unavailable', async () => {
  for (const options of [{ tabs: [] }, { rendererFailed: true }]) {
    const h = await quitHarness(options);
    assert.equal(await h.quit(() => h.calls.push('install')), false);
    assert.match(h.confirmation().message, /Close all agent sessions/);
    assert.deepEqual(h.calls, []);
  }
});

test('normal quit continues to clean up and quit without installing', async () => {
  const h = await quitHarness({ response: 0 });
  assert.equal(await h.quit(), true);
  assert.deepEqual(h.calls, ['detach-pty', 'detach-git', 'unwatch', 'kill-agents', 'quit']);
});

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const match = find(child, predicate);
    if (match) return match;
  }
}

test('About dialog shows download progress, install errors and explicit restart while preserving build metadata', async () => {
  const slots = [];
  let cursor = 0;
  const effects = [];
  let onStatus;
  let unsubscribed = false;
  let installs = 0;
  const react = {
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
    useEffect(effect) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = {};
        effects.push(effect);
      }
    },
  };
  const api = {
    updates: {
      getStatus: async () => ({ state: 'idle', currentVersion: '0.1.9', canInstall: false }),
      onStatus: (listener) => {
        onStatus = listener;
        return () => {
          unsubscribed = true;
        };
      },
      install: async () => {
        installs++;
        throw new Error('Restart failed');
      },
    },
  };
  const { code } = await transform(await source('src/renderer/components/AboutDialog.tsx'), {
    loader: 'tsx',
    format: 'cjs',
    jsx: 'automatic',
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', '__APP_BUILD_INFO__', code)(
    (id) => {
      if (id === 'react') return react;
      if (id === './ClaudeIcon') return { ClaudeIcon: 'icon' };
      return require(id);
    },
    module,
    module.exports,
    { api, addEventListener() {}, removeEventListener() {} },
    { version: '0.1.9', commit: '1234567890abcdef', dirty: false },
  );
  const render = () => {
    cursor = 0;
    return module.exports.AboutDialog({ onClose() {} });
  };
  render();
  const cleanups = effects.map((effect) => effect());
  await Promise.resolve();
  assert.ok(find(render(), (node) => node.props?.children === '0.1.9'));
  assert.ok(find(render(), (node) => node.props?.children === '1234567890ab'));
  onStatus({ state: 'downloading', version: '0.2.0', percent: 42, canInstall: false });
  assert.equal(find(render(), (node) => node.type === 'progress').props.value, 42);
  assert.equal(
    find(render(), (node) => node.props?.children === 'Check for updates').props.disabled,
    true,
  );
  onStatus({ state: 'downloaded', version: '0.2.0', canInstall: true });
  find(render(), (node) => node.props?.children === 'Restart to update').props.onClick();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(installs, 1);
  assert.equal(
    find(render(), (node) => node.props?.role === 'alert').props.children,
    'Restart failed',
  );
  onStatus({ state: 'unavailable', message: 'Packaged builds only', canInstall: false });
  assert.equal(
    find(render(), (node) => node.props?.children === 'Check for updates').props.disabled,
    true,
  );
  cleanups.forEach((cleanup) => cleanup?.());
  assert.equal(unsubscribed, true);
});

async function headerHarness(t, options = {}) {
  const slots = [];
  let cursor = 0;
  const effects = [];
  let onStatus;
  let unsubscribed = false;
  let installs = 0;
  let checks = 0;
  const ready = { state: 'downloaded', version: '0.1.10', canInstall: true };
  const react = {
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
    useEffect(effect) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = {};
        effects.push(effect);
      }
    },
  };
  const api = {
    platform: options.platform ?? 'linux',
    updates: {
      getStatus:
        options.getStatus ??
        (async () => ({ state: 'idle', currentVersion: '0.1.9', canInstall: false })),
      onStatus: (listener) => {
        onStatus = listener;
        return () => {
          unsubscribed = true;
        };
      },
      check: async () => {
        checks++;
        return ready;
      },
      install: async () => {
        installs++;
        return ready;
      },
    },
  };
  const { code } = await transform(await source('src/renderer/components/AppHeader.tsx'), {
    loader: 'tsx',
    format: 'cjs',
    jsx: 'automatic',
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', code)(
    (id) => {
      if (id === 'react') return react;
      if (id === './ClaudeIcon') return { ClaudeIcon: 'icon' };
      return require(id);
    },
    module,
    module.exports,
    { api },
  );
  const render = (fullscreen = false) => {
    cursor = 0;
    return module.exports.AppHeader({ fullscreen });
  };
  render();
  const cleanups = effects.map((effect) => effect());
  const dispose = () => cleanups.forEach((cleanup) => cleanup?.());
  t.after(dispose);
  await Promise.resolve();
  return {
    api,
    ready,
    render,
    dispose,
    status: (status) => onStatus(status),
    installs: () => installs,
    checks: () => checks,
    unsubscribed: () => unsubscribed,
  };
}

function updateButton(tree) {
  return find(
    tree,
    (node) => node.type === 'button' && node.props.className === 'app-update-button',
  );
}

function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  return [tree?.props?.children].flat(Infinity).map(text).join('');
}

test('header preserves the fullscreen title without showing updates for idle or unavailable builds', async (t) => {
  const h = await headerHarness(t);
  for (const state of ['idle', 'unavailable', 'checking', 'error']) {
    h.status({ state, canInstall: false });
    assert.equal(h.render(), null);
    assert.equal(h.render(true).props.className, 'app-header');
    assert.match(text(h.render(true)), /Parallel Agents/);
    assert.equal(updateButton(h.render(true)), undefined);
  }
});

test('Windows always renders its draggable native title row and releases caption spacing in fullscreen', async (t) => {
  const h = await headerHarness(t, { platform: 'win32' });
  for (const state of ['idle', 'unavailable', 'checking', 'error']) {
    h.status({ state, canInstall: false });
    assert.match(h.render().props.className, /\bapp-titlebar\b/);
    assert.equal(updateButton(h.render()), undefined);
    assert.match(text(h.render()), /Parallel Agents/);
    assert.doesNotMatch(h.render(true).props.className, /\bapp-titlebar\b/);
  }
  h.status(h.ready);
  assert.ok(updateButton(h.render()));
  assert.ok(updateButton(h.render(true)));
});

test('available updates stay at the top and show background download progress without installing', async (t) => {
  const h = await headerHarness(t);
  h.status({ state: 'available', version: '0.2.0', canInstall: false });
  assert.equal(h.render().props.className, 'app-header');
  assert.equal(updateButton(h.render()).props.disabled, true);
  assert.match(text(updateButton(h.render())), /Downloading update/);
  h.status({ state: 'downloading', version: '0.2.0', percent: 42.4, canInstall: false });
  assert.match(text(updateButton(h.render())), /42%/);
  assert.equal(updateButton(h.render()).props.disabled, true);
  assert.match(updateButton(h.render()).props.title, /0\.2\.0/);
  assert.equal(h.installs(), 0);
});

test('the persistent header action installs explicitly and remains available after cancellation or failure', async (t) => {
  const h = await headerHarness(t);
  h.status(h.ready);
  assert.match(text(updateButton(h.render())), /Restart to update/);
  assert.equal(updateButton(h.render()).props.disabled, false);
  assert.equal(h.installs(), 0);
  assert.doesNotMatch(text(h.render()), /Later/);
  updateButton(h.render()).props.onClick();
  assert.equal(updateButton(h.render()).props.disabled, true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.installs(), 1);
  assert.equal(updateButton(h.render()).props.disabled, false, 'cancellation keeps the action');
  h.status(h.ready);
  assert.ok(updateButton(h.render()), 'the same update cannot be dismissed');
  h.api.updates.install = async () => {
    throw new Error('Confirmation unavailable');
  };
  updateButton(h.render()).props.onClick();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    find(h.render(), (node) => node.props?.role === 'alert').props.children,
    'Confirmation unavailable',
  );
  assert.ok(updateButton(h.render()));
  h.status({ ...h.ready, state: 'installing' });
  assert.equal(updateButton(h.render()).props.disabled, true);
  assert.match(text(updateButton(h.render())), /Updating/);
});

test('failed downloads retain an explicit retry action and clear stale errors when status recovers', async (t) => {
  const h = await headerHarness(t);
  h.status({
    state: 'error',
    version: '0.2.0',
    message: 'Download failed',
    canInstall: false,
  });
  assert.equal(
    find(h.render(), (node) => node.props?.role === 'alert').props.children,
    'Download failed',
  );
  assert.match(text(updateButton(h.render())), /Retry update/);
  updateButton(h.render()).props.onClick();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.checks(), 1);
  assert.equal(
    find(h.render(), (node) => node.props?.role === 'alert'),
    undefined,
  );
  assert.match(text(updateButton(h.render())), /Restart to update/);
});

test('header subscribes before loading status and ignores stale loads and events after unmount', async (t) => {
  const loading = Promise.withResolvers();
  const h = await headerHarness(t, { getStatus: () => loading.promise });
  h.status(h.ready);
  loading.resolve({ state: 'idle', canInstall: false });
  await Promise.resolve();
  assert.ok(updateButton(h.render()), 'a stale snapshot must not hide a newer update event');
  h.dispose();
  assert.equal(h.unsubscribed(), true);
  h.status({ state: 'idle', canInstall: false });
  assert.ok(updateButton(h.render()), 'unmounted listeners must not change state');
});

test('a failed status load is visible and retryable from the header', async (t) => {
  const h = await headerHarness(t, {
    getStatus: async () => {
      throw new Error('Update status unavailable');
    },
  });
  await Promise.resolve();
  assert.equal(
    find(h.render(), (node) => node.props?.role === 'alert').props.children,
    'Update status unavailable',
  );
  updateButton(h.render()).props.onClick();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.checks(), 1);
  assert.equal(
    find(h.render(), (node) => node.props?.role === 'alert'),
    undefined,
  );
});

test('the app mounts the persistent update header before its panels and never mounts the CLI banner', async () => {
  const app = await source('src/renderer/App.tsx');
  assert.doesNotMatch(app, /AgentsBanner|UpdateReadyNotice/);
  assert.match(app, /<AppHeader fullscreen=\{fullscreen\}\s*\/>/);
  assert.ok(app.indexOf('<AppHeader ') < app.indexOf('className="app-body"'));
  const css = await source('src/renderer/styles/theme.css');
  assert.doesNotMatch(css, /\.agents-banner|\.ab-(?:chip|recheck|label)/);
});
