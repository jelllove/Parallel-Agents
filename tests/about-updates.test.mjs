import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build, transform } from 'esbuild';

const require = createRequire(import.meta.url);
const idle = { state: 'idle', currentVersion: '0.1.19', canInstall: false };
async function harness(
  component,
  { initial = idle, getStatus, platform = 'win32', openExternal } = {},
) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const listeners = new Set();
  const calls = [];
  const react = {
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: initial };
      return [
        slots[i].value,
        (v) => {
          slots[i].value = v;
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
      if (!slots[i] || deps.some((v, n) => !Object.is(v, slots[i].deps[n]))) {
        slots[i]?.cleanup?.();
        slots[i] = { deps };
        effects.push(() => {
          slots[i].cleanup = effect();
        });
      }
    },
  };
  const api = {
    platform,
    updates: {
      getStatus: getStatus ?? (async () => initial),
      onStatus: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      check: async () => {
        calls.push('check');
        return idle;
      },
      install: async () => {
        calls.push('install');
        return { ...idle, state: 'installing', canInstall: true };
      },
    },
    shell: {
      openExternal: async (url) => {
        calls.push(url);
        if (openExternal) return openExternal(url);
      },
    },
  };
  const result = await build({
    entryPoints: [`./src/renderer/components/${component}.tsx`],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    loader: { '.png': 'dataurl' },
  });
  const module = { exports: {} };
  new Function(
    'require',
    'module',
    'exports',
    'window',
    '__APP_BUILD_INFO__',
    result.outputFiles[0].text,
  )(
    (id) => (id === 'react' ? react : require(id)),
    module,
    module.exports,
    { api, addEventListener() {}, removeEventListener() {} },
    { version: '0.1.19', commit: '1234567890abcdef', dirty: false },
  );
  const render = () => {
    cursor = 0;
    effects = [];
    const tree = module.exports[component]({ onClose() {} });
    effects.forEach((fn) => fn());
    return tree;
  };
  render();
  await new Promise((resolve) => setImmediate(resolve));
  return {
    render,
    api,
    calls,
    emit(status) {
      listeners.forEach((fn) => fn(status));
    },
    unmount() {
      slots.forEach((slot) => slot.cleanup?.());
    },
    listenerCount: () => listeners.size,
  };
}
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const node = find(child, predicate);
    if (node) return node;
  }
}
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  return [tree.props?.children].flat(Infinity).map(text).join('');
}
const button = (tree, label) =>
  find(tree, (node) => node.type === 'button' && text(node) === label);

test('sidebar keeps the original simple About button without an update badge', async () => {
  const source = await readFile(
    new URL('../src/renderer/components/Sidebar.tsx', import.meta.url),
    'utf8',
  );
  const { code } = await transform(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (id) => {
      if (id === 'react') return { useState: (initial) => [initial, () => {}], useEffect() {} };
      if (id === 'react-resizable-panels')
        return { Panel: 'Panel', PanelGroup: 'PanelGroup', PanelResizeHandle: 'PanelResizeHandle' };
      if (id === '../store/app-store')
        return { useAppStore: (selector) => selector({ agents: [], agentStatus: {} }) };
      if (id.startsWith('./')) return { [id.slice(2)]: id.slice(2) };
      return require(id);
    },
    module,
    module.exports,
  );
  let opened = 0;
  const tree = module.exports.Sidebar({ onAbout: () => opened++ });
  const about = find(
    tree,
    (node) => node.type === 'button' && node.props.className === 'sidebar-about',
  );
  assert.ok(about, 'original About entry must be a plain button in the sidebar');
  assert.equal(text(about), 'iAbout');
  assert.equal(about.props.title, 'About');
  about.props.onClick();
  assert.equal(opened, 1);
  assert.equal(
    find(tree, (node) => node.props?.className === 'about-update-badge'),
    undefined,
  );
  const css = await readFile(new URL('../src/renderer/styles/theme.css', import.meta.url), 'utf8');
  assert.match(css, /\.sidebar-about\s*\{\s*display:\s*flex;/);
  assert.doesNotMatch(css, /\.about-update-badge/);
});

test('website and manual releases use exact external links and do not navigate the Electron page', async () => {
  const h = await harness('AboutDialog');
  const website = find(
    h.render(),
    (node) => node.type === 'a' && node.props.href === 'http://www.jelllove.com',
  );
  assert.ok(website);
  assert.equal(text(website), 'www.jelllove.com');
  let prevented = 0;
  await website.props.onClick({
    preventDefault() {
      prevented++;
    },
  });
  const releases = find(
    h.render(),
    (node) =>
      node.type === 'a' &&
      node.props.href === 'https://github.com/jelllove/Parallel-Agents/releases/latest',
  );
  assert.ok(releases);
  await releases.props.onClick({
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(prevented, 2);
  assert.deepEqual(h.calls, [
    'http://www.jelllove.com',
    'https://github.com/jelllove/Parallel-Agents/releases/latest',
  ]);
});

test('failed website/release browser opens display the actual error', async () => {
  const h = await harness('AboutDialog', {
    openExternal: async () => {
      throw new Error('No browser available');
    },
  });
  const website = find(
    h.render(),
    (node) => node.type === 'a' && node.props.href === 'http://www.jelllove.com',
  );
  await website.props.onClick({ preventDefault() {} });
  assert.match(
    text(find(h.render(), (node) => node.props.role === 'alert')),
    /No browser available/,
  );
});

test('manual update platforms show installed version and release download option without enabling automatic checks', async () => {
  const h = await harness('AboutDialog', {
    platform: 'darwin',
    initial: {
      ...idle,
      state: 'unavailable',
      message: 'Automatic updates are available only in packaged Windows builds.',
    },
  });
  assert.match(text(h.render()), /Installed version: 0\.1\.19/);
  assert.ok(button(h.render(), 'Check for updates').props.disabled);
  assert.match(text(h.render()), /manual/i);
  assert.ok(
    find(h.render(), (node) => node.type === 'a' && node.props.href?.endsWith('/releases/latest')),
  );
  assert.equal(h.calls.length, 0);
});

test('initial status failures have an explicit safe retry rather than a permanently disabled check', async () => {
  let loads = 0;
  const h = await harness('AboutDialog', {
    getStatus: async () => {
      if (++loads === 1) throw new Error('Status IPC unavailable');
      return idle;
    },
  });
  assert.match(
    text(find(h.render(), (node) => node.props.role === 'alert')),
    /Status IPC unavailable/,
  );
  const retry = button(h.render(), 'Retry update status');
  assert.ok(retry);
  await retry.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(button(h.render(), 'Check for updates').props.disabled, false);
  assert.deepEqual(h.calls, []);
});

test('initial status response cannot replace a later download event, and cleanup ignores late responses', async () => {
  const pending = Promise.withResolvers();
  const h = await harness('AboutDialog', { getStatus: () => pending.promise });
  h.emit({ ...idle, state: 'downloaded', version: '0.2.1', canInstall: true });
  pending.resolve(idle);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(text(h.render()), /Version 0\.2\.1 is ready to install/);
  h.unmount();
  assert.equal(h.listenerCount(), 0);
});

test('update actions use existing bridge and preserve native restart confirmation boundary', async () => {
  const h = await harness('AboutDialog');
  await button(h.render(), 'Check for updates').props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  h.emit({ ...idle, state: 'downloaded', version: '0.2.0', canInstall: true });
  await button(h.render(), 'Restart to update').props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.calls, ['check', 'install']);
  assert.match(text(h.render()), /Installing/);
});

test('pending actions reject repeat clicks and keep newer live status instead of a stale result', async () => {
  const h = await harness('AboutDialog');
  const pending = Promise.withResolvers();
  let checks = 0;
  h.api.updates.check = () => {
    checks++;
    return pending.promise;
  };
  const action = button(h.render(), 'Check for updates').props.onClick;
  const waiting = action();
  assert.equal(button(h.render(), 'Check for updates').props.disabled, true);
  await action();
  h.emit({ ...idle, state: 'downloaded', version: '0.3.0', canInstall: true });
  pending.resolve(idle);
  await waiting;
  assert.equal(checks, 1);
  assert.match(text(h.render()), /Version 0\.3\.0 is ready/);
});

test('closing About removes the listener and ignores pending status reads', async () => {
  const pending = Promise.withResolvers();
  const h = await harness('AboutDialog', { getStatus: () => pending.promise });
  h.unmount();
  pending.resolve({ ...idle, state: 'downloaded', version: '0.2.5', canInstall: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.listenerCount(), 0);
  assert.doesNotMatch(text(h.render()), /0\.2\.5/);
});

test('a stale initial status failure cannot hide a newer live update', async () => {
  const pending = Promise.withResolvers();
  const h = await harness('AboutDialog', { getStatus: () => pending.promise });
  h.emit({ ...idle, state: 'downloaded', version: '0.2.9', canInstall: true });
  pending.reject(new Error('Old status lookup failed'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(text(h.render()), /Version 0\.2\.9 is ready to install/);
});
