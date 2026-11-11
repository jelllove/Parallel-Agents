import assert from 'node:assert/strict';
import test from 'node:test';

import { PtyManager } from '../src/main/pty-session-manager.ts';

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spawned = [];
  const messages = [];
  const manager = new PtyManager((shell, args, options) => {
    let onData;
    let onExit;
    const terminal = {
      shell,
      args,
      options,
      writes: [],
      sizes: [],
      kills: 0,
      write(data) {
        this.writes.push(data);
      },
      resize(cols, rows) {
        this.sizes.push([cols, rows]);
      },
      kill() {
        this.kills += 1;
      },
      onData(listener) {
        onData = listener;
        return { dispose() {} };
      },
      onExit(listener) {
        onExit = listener;
        return { dispose() {} };
      },
      emitData(data) {
        onData(data);
      },
      emitExit(exitCode = 0) {
        onExit({ exitCode });
      },
    };
    spawned.push(terminal);
    return terminal;
  });
  manager.attachWindow({
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (...args) => messages.push(args),
    },
  });
  t.after(() => manager.killAll());
  return { manager, spawned, messages };
}

test('prepared observer environment belongs only to its PTY and releases on kill or cancellation', async (t) => {
  const { manager, spawned } = setup(t);
  const ended = [];
  await manager.spawn('observed', '.', 80, 24, 'claude', [], undefined, async () => ({
    command: 'claude --settings fixture',
    environment: { PA_ACTIVITY_TOKEN: 'fixture' },
    end: (state) => ended.push(state),
  }));
  assert.equal(spawned[0].options.env.PA_ACTIVITY_TOKEN, 'fixture');
  manager.kill('observed');
  assert.deepEqual(ended, ['unknown']);
  const pending = Promise.withResolvers();
  const starting = manager.spawn(
    'cancelled',
    '.',
    80,
    24,
    'claude',
    [],
    undefined,
    () => pending.promise,
  );
  manager.kill('cancelled');
  pending.resolve({ command: 'claude', environment: {}, end: (state) => ended.push(state) });
  assert.equal(await starting, false);
  assert.equal(ended.length, 2);
  assert.equal(spawned.length, 1);
});

test('a late exit from a replaced PTY cannot remove the current terminal', (t) => {
  const { manager, spawned, messages } = setup(t);
  manager.spawn('tab', '.', 80, 24);
  manager.kill('tab');
  manager.spawn('tab', '.', 80, 24);

  spawned[0].emitExit(1);

  assert.equal(manager.has('tab'), true);
  assert.deepEqual(messages, []);
});

test('a pending command cannot be injected into a replacement PTY', (t) => {
  const { manager, spawned } = setup(t);
  manager.spawn('tab', '.', 80, 24, 'old-command');
  manager.kill('tab');
  manager.spawn('tab', '.', 80, 24, 'new-command');

  t.mock.timers.tick(250);

  assert.deepEqual(spawned[0].writes, []);
  assert.deepEqual(spawned[1].writes, ['new-command\r']);
});

test('a replaced PTY cannot send stale output to the current tab', (t) => {
  const { manager, spawned, messages } = setup(t);
  manager.spawn('tab', '.', 80, 24);
  manager.kill('tab');
  manager.spawn('tab', '.', 80, 24);

  spawned[0].emitData('stale output');
  spawned[1].emitData('current output');

  assert.deepEqual(messages, [['pty:data', 'tab', 'current output']]);
});

test('the current PTY forwards output and exit and removes its own entry', (t) => {
  const { manager, spawned, messages } = setup(t);
  manager.spawn('tab', '.', 80, 24);

  spawned[0].emitData('output');
  spawned[0].emitExit(0);

  assert.deepEqual(messages, [
    ['pty:data', 'tab', 'output'],
    ['pty:exit', 'tab', 0],
  ]);
  assert.equal(manager.has('tab'), false);
});

test('checkout removal waits for killed native PTYs and rejects active or starting terminals', async (t) => {
  const { manager, spawned } = setup(t);
  await manager.spawn('tab', '/checkout', 80, 24);
  const contains = async (cwd) => cwd === '/checkout';
  await assert.rejects(manager.waitForCheckoutIdle(contains), /open or starting/);
  manager.kill('tab');
  let done = false;
  const waiting = manager.waitForCheckoutIdle(contains).then(() => {
    done = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(done, false);
  spawned[0].emitExit();
  await waiting;
  assert.equal(done, true);
  const pending = Promise.withResolvers();
  const starting = manager.spawn(
    'pending',
    '/checkout',
    80,
    24,
    'claude',
    [],
    undefined,
    () => pending.promise,
  );
  await assert.rejects(manager.waitForCheckoutIdle(contains), /open or starting/);
  manager.kill('pending');
  pending.resolve(undefined);
  await starting;
});

test('checkout removal times out if a killed PTY never emits its exit callback', async (t) => {
  const { manager } = setup(t);
  await manager.spawn('tab', '/checkout', 80, 24);
  manager.kill('tab');
  const waiting = manager.waitForCheckoutIdle(async () => true, 100);
  const rejected = assert.rejects(waiting, /Timed out/);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(100);
  await rejected;
});

test('terminal dimensions retain their existing minimum bounds', (t) => {
  const { manager, spawned } = setup(t);
  manager.spawn('tab', '.', 1, 1);
  manager.resize('tab', 0, -1);

  assert.equal(spawned[0].options.cols, 20);
  assert.equal(spawned[0].options.rows, 5);
  assert.deepEqual(spawned[0].sizes, [[20, 5]]);
});

test('killing all PTYs prevents delayed startup commands', (t) => {
  const { manager, spawned } = setup(t);
  manager.spawn('first', '.', 80, 24, 'first-command');
  manager.spawn('second', '.', 80, 24, 'second-command');

  manager.killAll();
  t.mock.timers.tick(250);

  assert.equal(manager.has('first'), false);
  assert.equal(manager.has('second'), false);
  assert.deepEqual(
    spawned.map((terminal) => terminal.kills),
    [1, 1],
  );
  assert.deepEqual(
    spawned.map((terminal) => terminal.writes),
    [[], []],
  );
});

test('native resize failures are reported instead of silently ignored', (t) => {
  const { manager, spawned } = setup(t);
  const warning = t.mock.method(console, 'warn', () => {});
  const error = new Error('resize failed');
  manager.spawn('tab', '.', 80, 24);
  spawned[0].resize = () => {
    throw error;
  };

  manager.resize('tab', 90, 30);

  assert.equal(warning.mock.callCount(), 1);
  assert.equal(warning.mock.calls[0].arguments[1], error);
});

test('native kill failures are reported without blocking cleanup of other PTYs', (t) => {
  const { manager, spawned } = setup(t);
  const warning = t.mock.method(console, 'warn', () => {});
  const error = new Error('kill failed');
  manager.spawn('first', '.', 80, 24);
  manager.spawn('second', '.', 80, 24);
  spawned[0].kill = () => {
    throw error;
  };

  manager.killAll();

  assert.equal(warning.mock.callCount(), 1);
  assert.equal(warning.mock.calls[0].arguments[1], error);
  assert.equal(spawned[1].kills, 1);
  assert.equal(manager.has('first'), false);
  assert.equal(manager.has('second'), false);
});

test('closing a tab while launch confirmation is pending cannot start a late orphan process', async (t) => {
  const { manager, spawned } = setup(t);
  const pending = Promise.withResolvers();
  const starting = manager.spawn(
    'pending',
    '.',
    80,
    24,
    'copilot',
    undefined,
    undefined,
    () => pending.promise,
  );
  manager.kill('pending');
  pending.resolve('copilot --allow-all-tools');
  assert.equal(await starting, false);
  assert.deepEqual(spawned, []);
  assert.equal(manager.has('pending'), false);
});

test('duplicate launches do not display duplicate confirmations, and declined launches spawn nothing', async (t) => {
  const { manager, spawned } = setup(t);
  const pending = Promise.withResolvers();
  let prompts = 0;
  const prepare = () => {
    prompts++;
    return pending.promise;
  };
  const first = manager.spawn('pending', '.', 80, 24, 'copilot', undefined, undefined, prepare);
  assert.equal(
    await manager.spawn('pending', '.', 80, 24, 'copilot', undefined, undefined, prepare),
    false,
  );
  pending.reject(new Error('Launch cancelled'));
  await assert.rejects(first, /cancelled/);
  assert.equal(prompts, 1);
  assert.deepEqual(spawned, []);
});
