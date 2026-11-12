import assert from 'node:assert/strict';
import test from 'node:test';
import {
  freshHistoryRead,
  shareHistoryRead,
  withFreshHistory,
  withHistoryRead,
} from '../src/main/history-read-context.ts';
test('provider indexes share within one request, never across freshness or later mutations', async () => {
  let reads = 0;
  const read = () => shareHistoryRead('provider', async () => ++reads);
  await withHistoryRead(async () => {
    assert.equal(freshHistoryRead(), false);
    assert.deepEqual(await Promise.all([read(), read()]), [1, 1]);
    await withFreshHistory(async () => {
      assert.equal(freshHistoryRead(), true);
      assert.equal(await read(), 2);
    });
    assert.equal(await read(), 1);
  });
  assert.equal(freshHistoryRead(), false);
  assert.equal(await withHistoryRead(read), 3);
});
