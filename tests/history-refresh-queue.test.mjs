import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistoryRefreshQueue } from '../src/renderer/store/history-refresh-queue.ts';
const flush = () => new Promise((resolve) => setImmediate(resolve));
test('history refresh coalesces bursts with one trailing read and closes without queued work', async () => {
  const pending = Promise.withResolvers(),
    calls = [];
  const queue = createHistoryRefreshQueue({
    refresh: async (id) => {
      calls.push(id);
      if (calls.length === 1) await pending.promise;
    },
    failed() {
      throw new Error('unexpected');
    },
  });
  queue.request(['one', 'one']);
  queue.request(['one', 'two']);
  queue.request(['one', 'two']);
  assert.deepEqual(calls, ['one']);
  pending.resolve();
  await flush();
  assert.deepEqual(calls, ['one', 'one', 'two']);
  queue.close();
  queue.request(['three']);
  assert.equal(calls.length, 3);
});
test('history refresh failures remain visible and do not poison later reads', async () => {
  let errors = 0,
    calls = 0;
  const q = createHistoryRefreshQueue({
    refresh: async () => {
      if (++calls === 1) throw new Error('disk');
    },
    failed: () => errors++,
  });
  q.request(['one', 'two']);
  await flush();
  assert.equal(errors, 1);
  assert.equal(calls, 2);
  q.close();
});
