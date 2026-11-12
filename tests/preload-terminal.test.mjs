import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

test('preload routes output through one keyed dispatcher and releases subscriptions', async () => {
  const { code } = await transform(
    await readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8'),
    { loader: 'ts', format: 'cjs' },
  );
  const ipc = new EventEmitter();
  const acknowledgements = [];
  ipc.send = (...args) => acknowledgements.push(args);
  let api;
  new Function('require', code)(() => ({
    ipcRenderer: ipc,
    contextBridge: { exposeInMainWorld: (_name, value) => (api = value) },
  }));
  const a = [],
    b = [],
    observed = [];
  const offA = api.pty.onData((...args) => a.push(args), 'a');
  const offB = api.pty.onData((...args) => b.push(args), 'b');
  const offAll = api.pty.onData((...args) => observed.push(args));
  assert.equal(ipc.listenerCount('pty:data'), 1);
  const packet = { generation: 'stream', sequence: 1 };
  ipc.emit('pty:data', {}, 'a', '中文🙂', packet);
  assert.deepEqual(a, [['a', '中文🙂', packet]]);
  assert.deepEqual(b, []);
  assert.deepEqual(observed, a);
  assert.deepEqual(acknowledgements, [], 'dispatch is not consumption');
  api.pty.acknowledge('a', packet.generation, packet.sequence);
  assert.deepEqual(acknowledgements, [['pty:acknowledge', 'a', 'stream', 1]]);
  offA();
  offB();
  offAll();
  ipc.emit('pty:data', {}, 'a', 'obsolete', packet);
  assert.equal(a.length, 1);
  assert.equal(observed.length, 1);
  const replacement = [];
  const offReplacement = api.pty.onData((...args) => replacement.push(args), 'a');
  ipc.emit('pty:data', {}, 'a', 'current', packet);
  assert.equal(replacement[0][1], 'current');
  offReplacement();
});
