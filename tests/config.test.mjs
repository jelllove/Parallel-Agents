import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { createConfigStore } from '../src/main/config-store.ts';

function defaults() {
  return {
    pinned: [],
    hidden: [],
    lastAgentByProject: {},
    projectOrder: {},
    layout: { order: ['sidebar', 'middle', 'right'], sizes: [20, 58, 22] },
    theme: 'dark',
    confirmOnCloseTab: true,
    terminalMultilineEnter: true,
    terminalCopyPaste: true,
  };
}

async function setup(t, contents) {
  const directory = await fs.mkdtemp(join(process.cwd(), '.config-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 3 }));
  const path = join(directory, '.claude', 'parallel-agents.json');
  if (contents !== undefined) {
    await fs.mkdir(join(directory, '.claude'));
    await fs.writeFile(path, typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  return { config: createConfigStore(path), path };
}

function mockIo(t, method, replacement) {
  const mocked = t.mock.method(fs, method, replacement);
  syncBuiltinESMExports();
  const restore = () => {
    mocked.mock.restore();
    syncBuiltinESMExports();
  };
  t.after(restore);
  return restore;
}

test('missing config uses fresh defaults without creating a file', async (t) => {
  const { config, path } = await setup(t);
  assert.deepEqual(await config.loadConfig(), defaults());
  await assert.rejects(fs.readFile(path), { code: 'ENOENT' });
});

test('loaded configs and nested layouts do not expose the cache', async (t) => {
  const { config } = await setup(t);
  const snapshot = await config.loadConfig();
  snapshot.pinned.push('claude:uncommitted');
  snapshot.layout.sizes[0] = 99;
  snapshot.lastAgentByProject['claude:uncommitted'] = 'codex';

  assert.deepEqual(await config.loadConfig(), defaults());
  const layout = await config.getLayout();
  layout.order.reverse();
  assert.deepEqual(await config.getLayout(), defaults().layout);
});

test('concurrent first mutations retain every independent change on disk', async (t) => {
  const { config, path } = await setup(t);
  await Promise.all([
    config.setTheme('light'),
    config.setTerminalCopyPaste(false),
    config.setLastAgent('claude:first', 'codex'),
    config.setLastAgent('gemini:second', 'copilot'),
    config.setProjectOrder('claude', ['claude:first']),
  ]);

  const expected = {
    ...defaults(),
    theme: 'light',
    terminalCopyPaste: false,
    lastAgentByProject: { 'claude:first': 'codex', 'gemini:second': 'copilot' },
    projectOrder: { claude: ['claude:first'] },
  };
  assert.deepEqual(await config.loadConfig(), expected);
  assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf8')), expected);
});

test('caller-owned layout and order arrays cannot change a saved config', async (t) => {
  const { config, path } = await setup(t);
  const layout = { order: ['right', 'middle', 'sidebar'], sizes: [22, 58, 20] };
  const ids = ['claude:project'];
  await config.setLayout(layout);
  await config.setProjectOrder('claude', ids);
  layout.sizes[0] = 99;
  ids.push('claude:uncommitted');

  assert.deepEqual(await config.loadConfig(), JSON.parse(await fs.readFile(path, 'utf8')));
});

test('valid false settings survive loading and unrelated writes', async (t) => {
  const initial = {
    ...defaults(),
    confirmOnCloseTab: false,
    terminalMultilineEnter: false,
    terminalCopyPaste: false,
  };
  const { config, path } = await setup(t, initial);
  await config.setTheme('light');
  assert.deepEqual(await config.loadConfig(), { ...initial, theme: 'light' });
  assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf8')), { ...initial, theme: 'light' });
});

test('malformed JSON is reported and cannot be overwritten by a mutation', async (t) => {
  const text = '{"pinned":';
  const { config, path } = await setup(t, text);
  await assert.rejects(config.loadConfig(), /config.*json|json.*config/i);
  await assert.rejects(config.setTheme('light'), /config.*json|json.*config/i);
  await assert.rejects(config.saveConfig(defaults()), /config.*json|json.*config/i);
  assert.equal(await fs.readFile(path, 'utf8'), text);
});

test('unexpected read failures are reported instead of treated as first run', async (t) => {
  const { config, path } = await setup(t);
  await fs.mkdir(path, { recursive: true });
  await assert.rejects(config.loadConfig(), /EISDIR|EPERM|EACCES/);
});

test('a failed write leaves the cached config unchanged and allows a later mutation', async (t) => {
  const { config, path } = await setup(t, defaults());
  await config.loadConfig();
  const failure = Object.assign(new Error('ENOSPC: simulated disk full'), { code: 'ENOSPC' });
  const restore = mockIo(t, 'writeFile', async () => {
    throw failure;
  });
  await assert.rejects(config.setTheme('light'), /ENOSPC/);
  assert.deepEqual(await config.loadConfig(), defaults());
  restore();

  await config.setTerminalCopyPaste(false);
  assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf8')), {
    ...defaults(),
    terminalCopyPaste: false,
  });
});

test('a partial failed write never truncates the previous config file', async (t) => {
  const { config, path } = await setup(t, defaults());
  await config.loadConfig();
  const original = await fs.readFile(path, 'utf8');
  const writeFile = fs.writeFile;
  mockIo(t, 'writeFile', async (file, data, options) => {
    await writeFile(file, String(data).slice(0, 12), options);
    throw Object.assign(new Error('ENOSPC: simulated partial write'), { code: 'ENOSPC' });
  });

  await assert.rejects(config.setTheme('light'), /ENOSPC/);
  assert.equal(await fs.readFile(path, 'utf8'), original);
  assert.deepEqual(await fs.readdir(dirname(path)), ['parallel-agents.json']);
});

test('legacy migration finishes persisting before the first load resolves', async (t) => {
  const { config, path } = await setup(t, {
    pinned: ['C--legacy', 'copilot:C:\\existing'],
    hidden: ['D--hidden'],
    lastAgentByProject: { 'C--legacy': 'claude' },
  });
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const finished = Promise.withResolvers();
  const writeFile = fs.writeFile;
  mockIo(t, 'writeFile', async (...args) => {
    started.resolve();
    await release.promise;
    try {
      return await writeFile(...args);
    } finally {
      finished.resolve();
    }
  });
  let resolved = false;
  const loading = config.loadConfig().then((value) => {
    resolved = true;
    return value;
  });
  await started.promise;
  await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.equal(resolved, false);
  } finally {
    release.resolve();
    await loading;
    await finished.promise;
  }

  const expected = {
    ...defaults(),
    pinned: ['claude:C--legacy', 'copilot:C:\\existing'],
    hidden: ['claude:D--hidden'],
    lastAgentByProject: { 'claude:C--legacy': 'claude' },
  };
  assert.deepEqual(await loading, expected);
  assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf8')), expected);
});

test('duplicate layout panes are rejected without changing the file', async (t) => {
  const { config, path } = await setup(t, defaults());
  const original = await fs.readFile(path, 'utf8');
  await assert.rejects(
    config.setLayout({ order: ['sidebar', 'sidebar', 'right'], sizes: [20, 58, 22] }),
    /layout/i,
  );
  assert.equal(await fs.readFile(path, 'utf8'), original);
});

test('unknown agent ids are rejected without changing the file', async (t) => {
  const { config, path } = await setup(t, defaults());
  const original = await fs.readFile(path, 'utf8');
  await assert.rejects(config.setLastAgent('claude:project', 'unknown-agent'), /agent/i);
  await assert.rejects(config.setProjectOrder('unknown-agent', []), /agent/i);
  assert.equal(await fs.readFile(path, 'utf8'), original);
});

test('concurrent first reads share one load and return independent snapshots', async (t) => {
  const { config, path } = await setup(t, defaults());
  const readFile = fs.readFile;
  let reads = 0;
  mockIo(t, 'readFile', async (file, ...args) => {
    if (file === path) reads += 1;
    return readFile(file, ...args);
  });
  const [first, second] = await Promise.all([config.loadConfig(), config.loadConfig()]);
  assert.equal(reads, 1);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.layout.sizes, second.layout.sizes);
});

test('saveConfig snapshots caller data before asynchronous work', async (t) => {
  const { config, path } = await setup(t);
  const input = defaults();
  const saving = config.saveConfig(input);
  input.pinned.push('claude:uncommitted');
  input.layout.sizes[0] = 99;
  await saving;
  assert.deepEqual(await config.loadConfig(), defaults());
  assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf8')), defaults());
});

test('setters snapshot layout and order inputs before entering the queue', async (t) => {
  const { config } = await setup(t);
  const layout = { order: ['right', 'middle', 'sidebar'], sizes: [22, 58, 20] };
  const ids = ['claude:project'];
  const savingLayout = config.setLayout(layout);
  const savingOrder = config.setProjectOrder('claude', ids);
  layout.sizes[0] = 99;
  ids.push('claude:uncommitted');
  await Promise.all([savingLayout, savingOrder]);
  const saved = await config.loadConfig();
  assert.deepEqual(saved.layout, { order: ['right', 'middle', 'sidebar'], sizes: [22, 58, 20] });
  assert.deepEqual(saved.projectOrder, { claude: ['claude:project'] });
});

test('a failed atomic replacement preserves disk, cache, and subsequent queued writes', async (t) => {
  const { config, path } = await setup(t, defaults());
  await config.loadConfig();
  const original = await fs.readFile(path, 'utf8');
  const rename = fs.rename;
  let first = true;
  mockIo(t, 'rename', async (...args) => {
    if (first) {
      first = false;
      assert.equal(await fs.readFile(path, 'utf8'), original);
      throw Object.assign(new Error('EACCES: simulated replacement failure'), { code: 'EACCES' });
    }
    return rename(...args);
  });
  const failed = config.setTheme('light');
  const snapshot = config.loadConfig();
  const next = config.setTerminalCopyPaste(false);
  const results = await Promise.allSettled([failed, snapshot, next]);
  assert.equal(results[0].status, 'rejected');
  assert.match(results[0].reason.message, /EACCES/);
  assert.equal(results[1].status, 'fulfilled');
  assert.deepEqual(results[1].value, defaults());
  assert.equal(results[2].status, 'fulfilled');
  assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf8')), {
    ...defaults(),
    terminalCopyPaste: false,
  });
  assert.deepEqual(await fs.readdir(dirname(path)), ['parallel-agents.json']);
});

const malformedConfigs = [
  ['null root', null],
  ['array root', []],
  ['string root', 'not an object'],
  ['non-array pinned', { pinned: null }],
  ['non-string hidden id', { hidden: [12] }],
  ['non-object last-agent map', { lastAgentByProject: [] }],
  ['unknown saved agent', { lastAgentByProject: { 'claude:project': 'unknown' } }],
  ['non-object project order', { projectOrder: [] }],
  ['unknown project-order agent', { projectOrder: { unknown: [] } }],
  ['non-array project ids', { projectOrder: { claude: 'claude:project' } }],
  [
    'invalid stored layout',
    { layout: { order: ['sidebar', 'sidebar', 'right'], sizes: [20, 58, 22] } },
  ],
  ['invalid stored theme', { theme: 'automatic' }],
  ['invalid stored boolean', { terminalCopyPaste: 'false' }],
];

for (const [name, value] of malformedConfigs) {
  test(`rejects ${name} without replacing existing data`, async (t) => {
    const text = JSON.stringify(value);
    const { config, path } = await setup(t, text);
    await assert.rejects(config.loadConfig(), /Invalid configuration/i);
    await assert.rejects(config.saveConfig(defaults()), /Invalid configuration/i);
    assert.equal(await fs.readFile(path, 'utf8'), text);
  });
}

const invalidLayouts = [
  ['unknown pane', { order: ['sidebar', 'middle', 'unknown'], sizes: [20, 58, 22] }],
  ['wrong tuple length', { order: ['sidebar', 'middle'], sizes: [20, 80] }],
  ['non-finite size', { order: ['sidebar', 'middle', 'right'], sizes: [NaN, 58, 22] }],
  ['negative size', { order: ['sidebar', 'middle', 'right'], sizes: [-10, 88, 22] }],
  ['non-numeric size', { order: ['sidebar', 'middle', 'right'], sizes: ['20', 58, 22] }],
  ['invalid percentage total', { order: ['sidebar', 'middle', 'right'], sizes: [20, 20, 20] }],
];

for (const [name, layout] of invalidLayouts) {
  test(`rejects a layout with ${name}`, async (t) => {
    const { config, path } = await setup(t, defaults());
    const original = await fs.readFile(path, 'utf8');
    await assert.rejects(config.setLayout(layout), /layout/i);
    assert.equal(await fs.readFile(path, 'utf8'), original);
  });
}

test('setting, project id, and project order inputs are validated at runtime', async (t) => {
  const { config, path } = await setup(t, defaults());
  const original = await fs.readFile(path, 'utf8');
  await assert.rejects(config.setTheme('automatic'), /theme/i);
  await assert.rejects(config.setConfirmOnCloseTab('false'), /confirmOnCloseTab/i);
  await assert.rejects(config.setTerminalMultilineEnter(0), /terminalMultilineEnter/i);
  await assert.rejects(config.setTerminalCopyPaste(null), /terminalCopyPaste/i);
  await assert.rejects(config.setLastAgent('', 'claude'), /project/i);
  await assert.rejects(config.setProjectOrder('claude', [42]), /project/i);
  assert.equal(await fs.readFile(path, 'utf8'), original);
});

test('pin and hide mutations compose with concurrent settings changes', async (t) => {
  const { config, path } = await setup(t);
  await Promise.all([
    config.setProjectPinned('claude:first', true),
    config.setProjectPinned('claude:second', true),
    config.setProjectHidden('gemini:hidden', true),
    config.setConfirmOnCloseTab(false),
    config.setTerminalMultilineEnter(false),
  ]);
  const expected = {
    ...defaults(),
    pinned: ['claude:first', 'claude:second'],
    hidden: ['gemini:hidden'],
    confirmOnCloseTab: false,
    terminalMultilineEnter: false,
  };
  assert.deepEqual(await config.loadConfig(), expected);
  assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf8')), expected);
  assert.equal(await config.getConfirmOnCloseTab(), false);
  assert.equal(await config.getTerminalMultilineEnter(), false);
});

test('pin and hide operations validate flags, avoid duplicates, and remove only the requested id', async (t) => {
  const { config } = await setup(t);
  await Promise.all([
    config.setProjectPinned('claude:first', true),
    config.setProjectPinned('claude:first', true),
    config.setProjectPinned('claude:second', true),
    config.setProjectHidden('claude:first', true),
    config.setProjectHidden('claude:second', true),
    config.setProjectPinned('claude:first', false),
    config.setProjectHidden('claude:first', false),
  ]);
  await assert.rejects(config.setProjectPinned('claude:first', 'false'), /pinned/i);
  await assert.rejects(config.setProjectHidden('', true), /project/i);
  await assert.rejects(config.setProjectHidden('claude:first', 1), /hidden/i);
  const saved = await config.loadConfig();
  assert.deepEqual(saved.pinned, ['claude:second']);
  assert.deepEqual(saved.hidden, ['claude:second']);
});

test('forgetProject removes every reference without losing queued changes', async (t) => {
  const initial = {
    ...defaults(),
    pinned: ['claude:removed', 'claude:kept'],
    hidden: ['claude:removed', 'gemini:kept'],
    lastAgentByProject: { 'claude:removed': 'codex', 'claude:kept': 'claude' },
    projectOrder: {
      claude: ['claude:removed', 'claude:kept'],
      codex: ['claude:removed', 'codex:kept'],
    },
  };
  const { config, path } = await setup(t, initial);
  await Promise.all([
    config.setTheme('light'),
    config.forgetProject('claude:removed'),
    config.setLastAgent('gemini:added', 'gemini'),
  ]);
  const expected = {
    ...defaults(),
    pinned: ['claude:kept'],
    hidden: ['gemini:kept'],
    lastAgentByProject: { 'claude:kept': 'claude', 'gemini:added': 'gemini' },
    projectOrder: { claude: ['claude:kept'], codex: ['codex:kept'] },
    theme: 'light',
  };
  assert.deepEqual(await config.loadConfig(), expected);
  assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf8')), expected);
  assert.equal(await config.getLastAgent('claude:removed'), null);
  assert.equal(await config.getLastAgent('gemini:added'), 'gemini');
  await assert.rejects(config.forgetProject(null), /project/i);
});

test('unknown project ids never resolve inherited object properties as agents', async (t) => {
  const { config } = await setup(t);
  assert.equal(await config.getLastAgent('constructor'), null);
  assert.equal(await config.getLastAgent('__proto__'), null);
  assert.equal(await config.getLastAgent('toString'), null);
});

test('missing legacy settings use defaults without rewriting an otherwise valid file', async (t) => {
  const text = JSON.stringify({ pinned: [], terminalCopyPaste: false, unused: 'ignored' });
  const { config, path } = await setup(t, text);
  assert.deepEqual(await config.loadConfig(), { ...defaults(), terminalCopyPaste: false });
  assert.equal(await config.getTerminalCopyPaste(), false);
  assert.equal(await fs.readFile(path, 'utf8'), text);
});

test('a failed initial migration is reported and a queued mutation retries it', async (t) => {
  const legacy = { pinned: ['C--legacy'], terminalCopyPaste: false };
  const { config, path } = await setup(t, legacy);
  const original = await fs.readFile(path, 'utf8');
  const rename = fs.rename;
  let fail = true;
  mockIo(t, 'rename', async (...args) => {
    if (fail) {
      fail = false;
      assert.equal(await fs.readFile(path, 'utf8'), original);
      throw Object.assign(new Error('EACCES: migration replacement denied'), { code: 'EACCES' });
    }
    return rename(...args);
  });
  const [first, second] = await Promise.allSettled([config.loadConfig(), config.setTheme('light')]);
  assert.equal(first.status, 'rejected');
  assert.match(first.reason.message, /EACCES/);
  assert.equal(second.status, 'fulfilled');
  const expected = {
    ...defaults(),
    pinned: ['claude:C--legacy'],
    terminalCopyPaste: false,
    theme: 'light',
  };
  assert.deepEqual(await config.loadConfig(), expected);
  assert.deepEqual(await createConfigStore(path).loadConfig(), expected);
  assert.deepEqual(await fs.readdir(dirname(path)), ['parallel-agents.json']);
});

test('a corrected malformed file can be retried without restarting the store', async (t) => {
  const { config, path } = await setup(t, '{broken');
  await assert.rejects(config.loadConfig(), /Invalid configuration/);
  await fs.writeFile(path, JSON.stringify({ ...defaults(), theme: 'light' }));
  assert.equal(await config.getTheme(), 'light');
  await config.setTerminalCopyPaste(false);
  assert.equal(await createConfigStore(path).getTerminalCopyPaste(), false);
});

test('a pending replacement keeps the previous file visible and queues readers', async (t) => {
  const { config, path } = await setup(t, defaults());
  await config.loadConfig();
  const original = await fs.readFile(path, 'utf8');
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const rename = fs.rename;
  mockIo(t, 'rename', async (source, destination) => {
    assert.equal(dirname(source), dirname(path));
    assert.equal(destination, path);
    assert.notEqual(source, destination);
    started.resolve();
    await release.promise;
    return rename(source, destination);
  });
  const writing = config.setTheme('light');
  await started.promise;
  let readFinished = false;
  const reading = config.getTheme().then((theme) => {
    readFinished = true;
    return theme;
  });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(readFinished, false);
    assert.equal(await fs.readFile(path, 'utf8'), original);
  } finally {
    release.resolve();
    await writing;
    await reading;
  }
  assert.equal(await reading, 'light');
  assert.deepEqual(await fs.readdir(dirname(path)), ['parallel-agents.json']);
});

test('a staging cleanup failure reports both I/O errors without replacing the original', async (t) => {
  const { config, path } = await setup(t, defaults());
  await config.loadConfig();
  const original = await fs.readFile(path, 'utf8');
  mockIo(t, 'rename', async () => {
    throw Object.assign(new Error('EACCES: replacement denied'), { code: 'EACCES' });
  });
  mockIo(t, 'unlink', async () => {
    throw Object.assign(new Error('EPERM: cleanup denied'), { code: 'EPERM' });
  });
  await assert.rejects(config.setTheme('light'), (error) => {
    assert.match(error.message, /EACCES.*cleanup.*EPERM/);
    assert.ok(error.cause instanceof AggregateError);
    assert.equal(error.cause.errors.length, 2);
    return true;
  });
  assert.equal(await fs.readFile(path, 'utf8'), original);
  assert.equal(await config.getTheme(), 'dark');
});

test('invalid full saves are rejected before touching the previous file', async (t) => {
  const { config, path } = await setup(t, defaults());
  const original = await fs.readFile(path, 'utf8');
  await assert.rejects(config.saveConfig(null), /Invalid configuration/);
  await assert.rejects(config.saveConfig({ ...defaults(), theme: false }), /theme/i);
  await assert.rejects(config.saveConfig({ ...defaults(), pinned: [null] }), /project/i);
  assert.equal(await fs.readFile(path, 'utf8'), original);
});

test('sparse project id arrays are rejected instead of persisting null entries', async (t) => {
  const { config, path } = await setup(t, defaults());
  const original = await fs.readFile(path, 'utf8');
  await assert.rejects(config.setProjectOrder('claude', new Array(1)), /project/i);
  await assert.rejects(config.saveConfig({ ...defaults(), pinned: new Array(1) }), /project/i);
  assert.equal(await fs.readFile(path, 'utf8'), original);
});

test('a sparse layout order is rejected', async (t) => {
  const { config } = await setup(t);
  const order = new Array(3);
  order[0] = 'sidebar';
  order[1] = 'middle';
  await assert.rejects(config.setLayout({ order, sizes: [20, 58, 22] }), /layout/i);
});

test('sparse layout sizes are rejected', async (t) => {
  const { config } = await setup(t);
  const sizes = new Array(3);
  sizes[0] = 100;
  await assert.rejects(
    config.setLayout({ order: ['sidebar', 'middle', 'right'], sizes }),
    /layout/i,
  );
});

test('valid rounded percentage layouts preserve their sizes', async (t) => {
  const { config } = await setup(t);
  const layout = { order: ['right', 'sidebar', 'middle'], sizes: [33.33, 33.33, 33.33] };
  await config.setLayout(layout);
  assert.deepEqual(await config.getLayout(), layout);
});
