import assert from 'node:assert/strict';
import test from 'node:test';
import { createMetadataCache } from '../src/main/metadata-cache.ts';

test('metadata cache shares concurrent reads, detects file changes and bypasses safety reads', async () => {
  let version = 'one',
    reads = 0;
  const cache = createMetadataCache(async () => version, 2);
  const read = async () => ({ value: ++reads });
  const results = await Promise.all([cache.read('/a', read), cache.read('/a', read)]);
  assert.deepEqual(results, [{ value: 1 }, { value: 1 }]);
  results[0].value = 99;
  assert.deepEqual(await cache.read('/a', read), { value: 1 });
  version = 'two';
  assert.deepEqual(await cache.read('/a', read), { value: 2 });
  assert.deepEqual(await cache.read('/a', read, true), { value: 3 });
});
test('metadata cache never retains errors, missing headers, unstable reads or invalidated results', async () => {
  let version = 'one';
  const cache = createMetadataCache(async () => version, 2);
  await assert.rejects(
    cache.read('/a', async () => {
      throw new Error('denied');
    }),
    /denied/,
  );
  assert.equal(await cache.read('/a', async () => null), null);
  assert.deepEqual(await cache.read('/a', async () => ({ ok: true })), { ok: true });
  const pending = Promise.withResolvers();
  const request = cache.read('/b', () => pending.promise);
  await new Promise((resolve) => setImmediate(resolve));
  cache.invalidate();
  pending.resolve({ old: true });
  await request;
  assert.deepEqual(await cache.read('/b', async () => ({ new: true })), { new: true });
  await cache.read('/c', async () => {
    version = 'changed';
    return { unstable: true };
  });
  assert.deepEqual(await cache.read('/c', async () => ({ stable: true })), { stable: true });
});
test('invalidation during the final signature check cannot repopulate the cache', async () => {
  const checking = Promise.withResolvers();
  const release = Promise.withResolvers();
  let calls = 0;
  const cache = createMetadataCache(async () => {
    if (++calls === 2) {
      checking.resolve();
      await release.promise;
    }
    return 'same';
  });
  const pending = cache.read('/a', async () => ({ stale: true }));
  await checking.promise;
  cache.invalidate();
  release.resolve();
  await pending;
  assert.deepEqual(await cache.read('/a', async () => ({ fresh: true })), { fresh: true });
});

test('metadata cache evicts old entries instead of retaining unbounded history', async () => {
  const cache = createMetadataCache(async () => 'same', 2);
  let reads = 0;
  for (const path of ['/a', '/b', '/c', '/a']) await cache.read(path, async () => ++reads);
  assert.equal(reads, 4);
});
