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
async function harness({ width = 1000, height = 600, anchorX = 980, anchorY = 580 } = {}) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let observer;
  let disconnected = false;
  let closed = 0;
  const listeners = new Map();
  const picked = [];
  const options = [];
  const rectangle = { width: 560, height: 280 };
  const react = {
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: initial };
      return [
        slots[i].value,
        (value) => (slots[i].value = typeof value === 'function' ? value(slots[i].value) : value),
      ];
    },
    useRef(initial) {
      const i = cursor++;
      slots[i] ??= { current: initial };
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
  react.useLayoutEffect = react.useEffect;
  const source = await readFile(
    new URL('../src/renderer/components/AgentPicker.tsx', import.meta.url),
    'utf8',
  );
  const { code } = await transform(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' });
  const module = { exports: {} };
  const win = {
    innerWidth: width,
    innerHeight: height,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
  };
  new Function('require', 'module', 'exports', 'window', 'ResizeObserver', code)(
    (id) => {
      if (id === 'react') return react;
      if (id === './AgentIcon') return { AgentIcon: 'AgentIcon' };
      if (id === '../store/app-store')
        return {
          useAppStore: (select) =>
            select({ showAgentLaunchSettings: (agent) => options.push(agent) }),
        };
      return require(id);
    },
    module,
    module.exports,
    win,
    class {
      constructor(callback) {
        observer = callback;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
  );
  const agents = ['claude', 'aider'].map((id) => ({
    id,
    displayName: id === 'claude' ? 'Claude Code with a long descriptive name' : 'Aider',
    installHint: 'Fixture install',
  }));
  const props = {
    agents,
    status: {
      claude: { available: true, path: 'C:/long/path/with spaces/to/installed/claude.cmd' },
      aider: { available: false },
    },
    anchorX,
    anchorY,
    onPick: (id) => picked.push(id),
    onClose: () => closed++,
    title: 'Pick an agent CLI',
  };
  return {
    picked,
    options,
    props,
    rectangle,
    win,
    listeners,
    closed: () => closed,
    disconnected: () => disconnected,
    resize: () => observer(),
    unmount: () => slots.forEach((slot) => slot.cleanup?.()),
    render() {
      cursor = 0;
      effects = [];
      const tree = module.exports.AgentPicker(props);
      for (const element of nodes(tree))
        if (element.ref) element.ref.current = { getBoundingClientRect: () => rectangle };
      effects.forEach((effect) => effect());
      return tree;
    },
  };
}
const button = (tree, label) =>
  nodes(tree).find((node) => node.type === 'button' && node.props['aria-label'] === label);

test('each agent has explicit New and Options; unavailable New does not disable Options', async () => {
  const h = await harness();
  const tree = h.render();
  const rows = nodes(tree).filter((node) => node.props?.className?.startsWith('agent-picker-row'));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.deepEqual(
      nodes(row)
        .filter((node) => node.type === 'button')
        .map((node) => node.props.children),
      ['New', 'Options'],
    );
    assert.equal(row.props.onClick, undefined);
  }
  const event = { stopPropagation() {} };
  const available = button(tree, `New project with ${h.props.agents[0].displayName}`);
  assert.equal(available.props.disabled, false);
  assert.equal(available.props.type, 'button');
  available.props.onClick(event);
  assert.deepEqual(h.picked, ['claude']);
  button(tree, `Configure ${h.props.agents[0].displayName} launch`).props.onClick(event);
  assert.deepEqual(h.options, ['claude']);
  assert.deepEqual(h.picked, ['claude']);
  const unavailable = button(tree, 'New project with Aider');
  assert.equal(unavailable.props.disabled, true);
  unavailable.props.onClick(event);
  assert.deepEqual(h.picked, ['claude']);
  const configure = button(tree, 'Configure Aider launch');
  assert.notEqual(configure.props.disabled, true);
  configure.props.onClick(event);
  assert.deepEqual(h.options, ['claude', 'aider']);
});
test('picker measures wrapped rows, clamps both edges and cleans up resize/Escape subscriptions', async () => {
  const h = await harness();
  h.render();
  let popup = nodes(h.render()).find((node) => node.props?.className === 'agent-picker');
  assert.deepEqual({ x: popup.props.style.left, y: popup.props.style.top }, { x: 432, y: 312 });
  h.rectangle.height = 550;
  h.resize();
  popup = nodes(h.render()).find((node) => node.props?.className === 'agent-picker');
  assert.equal(popup.props.style.top, 42);
  h.win.innerWidth = 800;
  h.win.innerHeight = 580;
  h.listeners.get('resize')();
  popup = nodes(h.render()).find((node) => node.props?.className === 'agent-picker');
  assert.equal(popup.props.style.left, 232);
  assert.equal(popup.props.style.top, 22);
  h.props.anchorX = -10;
  h.props.anchorY = -20;
  h.render();
  popup = nodes(h.render()).find((node) => node.props?.className === 'agent-picker');
  assert.equal(popup.props.style.left, 8);
  assert.equal(popup.props.style.top, 8);
  h.listeners.get('keydown')({ key: 'Enter' });
  assert.equal(h.closed(), 0);
  h.listeners.get('keydown')({ key: 'Escape' });
  assert.equal(h.closed(), 1);
  nodes(h.render())
    .find((node) => node.props?.className === 'agent-picker-backdrop')
    .props.onClick();
  assert.equal(h.closed(), 2);
  h.unmount();
  assert.equal(h.disconnected(), true);
  assert.equal(h.listeners.size, 0);
});
test('picker CSS reserves action width, wraps names/paths and separates only adjacent rows', async () => {
  const css = await readFile(new URL('../src/renderer/styles/theme.css', import.meta.url), 'utf8');
  assert.match(css, /\.agent-picker\s*\{[^}]*width:\s*min\(560px,/);
  assert.match(css, /\.agent-picker-row\s*\+\s*\.agent-picker-row\s*\{[^}]*border-top:/);
  for (const selector of ['agent-picker-name', 'agent-picker-sub']) {
    assert.match(css, new RegExp(`\\.${selector}\\s*\\{[^}]*white-space:\\s*normal;`));
    assert.match(css, new RegExp(`\\.${selector}\\s*\\{[^}]*overflow-wrap:\\s*anywhere;`));
  }
});
