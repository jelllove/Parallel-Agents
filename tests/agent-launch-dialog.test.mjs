import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
async function harness({ saved = {}, readError, writeError } = {}) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let closed = 0;
  const writes = [];
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
    useRef() {
      const i = cursor++;
      slots[i] ??= { current: { showModal() {} } };
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
  const result = await build({
    entryPoints: ['src/renderer/components/AgentLaunchDialog.tsx'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', result.outputFiles[0].text)(
    (id) => (id === 'react' ? react : require(id)),
    module,
    module.exports,
    {
      api: {
        agents: {
          getLaunchSettings: async () => {
            if (readError) throw readError;
            return saved;
          },
          setLaunchOptions: async (...args) => {
            if (writeError) throw writeError;
            writes.push(args);
          },
        },
      },
    },
  );
  const render = () => {
    cursor = 0;
    effects = [];
    const tree = module.exports.AgentLaunchDialog({ agent: 'copilot', onClose: () => closed++ });
    effects.forEach((effect) => effect());
    return tree;
  };
  render();
  await new Promise((resolve) => setImmediate(resolve));
  return { render, writes, closed: () => closed };
}
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const value = find(child, predicate);
    if (value) return value;
  }
}
const field = (tree, label) => find(tree, (node) => node.props['aria-label'] === label);

test('saved models load independently and switching provider displays its own modes and model', async () => {
  const h = await harness({
    saved: {
      copilot: { approvalMode: 'default', model: 'copilot-model' },
      claude: { approvalMode: 'plan', model: 'sonnet' },
    },
  });
  assert.equal(field(h.render(), 'Model ID').props.value, 'copilot-model');
  field(h.render(), 'Agent').props.onChange({ target: { value: 'claude' } });
  h.render();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(field(h.render(), 'Model ID').props.value, 'sonnet');
  assert.equal(field(h.render(), 'Approval mode').props.value, 'plan');
});

test('reduced approval modes cannot be saved without explicit acknowledgement', async () => {
  const h = await harness();
  field(h.render(), 'Approval mode').props.onChange({ target: { value: 'auto-tools' } });
  assert.equal(
    find(h.render(), (node) => node.type === 'button' && node.props.type === 'submit').props
      .disabled,
    true,
  );
  field(h.render(), 'Acknowledge reduced approvals').props.onChange({ target: { checked: true } });
  await find(h.render(), (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.deepEqual(h.writes, [['copilot', { approvalMode: 'auto-tools', model: '' }, true]]);
  assert.equal(h.closed(), 1);
});

test('unacknowledged risky form submission also fails when invoked without a button', async () => {
  const h = await harness();
  field(h.render(), 'Approval mode').props.onChange({ target: { value: 'auto-tools' } });
  await find(h.render(), (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.deepEqual(h.writes, []);
  assert.equal(h.closed(), 0);
});

test('load errors never silently replace saved choices or allow overwriting them', async () => {
  const h = await harness({ readError: new Error('Malformed launch settings') });
  assert.match(
    find(h.render(), (node) => node.props.role === 'alert').props.children,
    /Malformed launch settings/,
  );
  assert.equal(
    find(h.render(), (node) => node.type === 'button' && node.props.type === 'submit').props
      .disabled,
    true,
  );
});

test('write errors leave the dialog open and show the actual failure', async () => {
  const h = await harness({ writeError: new Error('Disk is read-only') });
  await find(h.render(), (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(h.closed(), 0);
  assert.match(
    find(h.render(), (node) => node.props.role === 'alert').props.children,
    /Disk is read-only/,
  );
});

test('unsafe model input cannot produce a launch command or save settings', async () => {
  const h = await harness();
  field(h.render(), 'Model ID').props.onChange({ target: { value: 'fake;echo injected' } });
  const tree = h.render();
  assert.match(find(tree, (node) => node.props.role === 'alert').props.children, /Model/);
  await find(tree, (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.deepEqual(h.writes, []);
});

test('managed launch settings are wired at every agent PTY seam and visible in launch surfaces', async () => {
  const ipc = await readFile(new URL('../src/main/ipc.ts', import.meta.url), 'utf8');
  assert.match(ipc, /prepareAgentLaunch\(command/);
  assert.match(ipc, /opts\.shellProfile,\s+prepareCommand/);
  for (const path of ['AgentPicker.tsx', 'NewProjectDialog.tsx', 'SettingsPicker.tsx']) {
    const text = await readFile(
      new URL(`../src/renderer/components/${path}`, import.meta.url),
      'utf8',
    );
    assert.match(text, /showAgentLaunchSettings/);
  }
});
