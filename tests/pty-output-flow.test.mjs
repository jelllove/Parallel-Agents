import assert from 'node:assert/strict';
import test from 'node:test';
import { PtyOutputFlow } from '../src/main/pty-output-flow.ts';
function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent = [],
    pressure = [];
  const flow = new PtyOutputFlow(
    {
      send: (data, packet) => sent.push({ data, packet }),
      pause: () => pressure.push('pause'),
      resume: () => pressure.push('resume'),
    },
    'generation',
  );
  return { flow, sent, pressure };
}
test('terminal output batches preserve exact ANSI/Unicode order and flush before exit', (t) => {
  const { flow, sent } = fixture(t);
  for (const text of ['hello', '\x1b[32m', '中文', '\ud83d', '\ude42', '\x1b[0m']) flow.push(text);
  assert.equal(sent.length, 0);
  t.mock.timers.tick(8);
  assert.equal(sent.map((x) => x.data).join(''), 'hello\x1b[32m中文🙂\x1b[0m');
  flow.push('last');
  flow.finish();
  assert.equal(sent.at(-1).data, 'last');
  flow.dispose();
});
test('terminal output applies backpressure, validates acknowledgements and resumes below low watermark', (t) => {
  const { flow, sent, pressure } = fixture(t);
  flow.push('x'.repeat(300000));
  t.mock.timers.tick(8);
  assert.deepEqual(pressure, ['pause']);
  assert.ok(sent.every((x) => x.data.length <= 32768));
  flow.acknowledge('old', 999);
  flow.acknowledge('generation', 999);
  assert.deepEqual(pressure, ['pause']);
  for (const item of [...sent]) flow.acknowledge('generation', item.packet.sequence);
  t.mock.timers.tick(8);
  for (const item of [...sent]) flow.acknowledge('generation', item.packet.sequence);
  assert.equal(pressure.at(-1), 'resume');
  flow.dispose();
});
test('old-generation, duplicate and future acknowledgements never release another batch', (t) => {
  const { flow, sent } = fixture(t);
  flow.push('x'.repeat(400000));
  t.mock.timers.tick(8);
  const first = sent[0].packet.sequence;
  const initial = sent.length;
  flow.acknowledge('old-generation', first);
  flow.acknowledge('generation', 999);
  assert.equal(sent.length, initial);
  flow.acknowledge('generation', first);
  assert.equal(sent.length, initial + 1);
  flow.acknowledge('generation', first);
  assert.equal(sent.length, initial + 1);
  flow.dispose();
});

test('acknowledgements do not bypass the batching interval and split surrogate pairs survive separate ticks', (t) => {
  const { flow, sent } = fixture(t);
  flow.push('first');
  t.mock.timers.tick(8);
  flow.push('second');
  flow.acknowledge('generation', sent[0].packet.sequence);
  assert.equal(sent.length, 1);
  t.mock.timers.tick(8);
  assert.equal(sent[1].data, 'second');
  flow.push('\ud83d');
  t.mock.timers.tick(8);
  flow.push('\ude42');
  t.mock.timers.tick(8);
  assert.equal(sent.at(-1).data, '🙂');
  flow.dispose();
});
test('exit drains a large final tail within the watermark before reporting completion', (t) => {
  const { flow, sent } = fixture(t);
  const text = '\x1b[32m中文🙂\x1b[0m'.repeat(50000);
  let finished = 0;
  flow.push(text);
  flow.finish(() => finished++);
  assert.equal(finished, 0);
  assert.ok(sent.reduce((size, item) => size + item.data.length, 0) <= 262144);
  let consumed = 0;
  while (consumed < sent.length) {
    const item = sent[consumed++];
    flow.acknowledge('generation', item.packet.sequence);
    assert.ok(sent.slice(consumed).reduce((size, next) => size + next.data.length, 0) <= 262144);
  }
  assert.equal(finished, 1);
  assert.equal(sent.map((item) => item.data).join(''), text);
  flow.dispose();
});

test('disposed output ignores stale flushes and does not send replacement data', (t) => {
  const { flow, sent } = fixture(t);
  flow.push('old');
  flow.dispose();
  t.mock.timers.tick(100);
  assert.deepEqual(sent, []);
  flow.push('late');
  assert.deepEqual(sent, []);
});
