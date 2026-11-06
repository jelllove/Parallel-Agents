import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackgroundOperations } from '../src/renderer/store/background-operations.ts';

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('operations run serially, deduplicate targets and publish completion only after settling', async () => {
  const store = createBackgroundOperations();
  const pending = Promise.withResolvers();
  const calls = [];
  const first = store.getState().enqueue({
    key: 'create:repo',
    title: 'Create repo',
    run: async () => {
      calls.push('first');
      await pending.promise;
      return { message: 'Created repo', projectId: 'repo' };
    },
  });
  assert.ok(first);
  assert.equal(
    store.getState().enqueue({
      key: 'create:repo',
      title: 'Duplicate',
      run: async () => {
        throw new Error('duplicate');
      },
    }),
    null,
  );
  store.getState().enqueue({
    key: 'delete:other',
    title: 'Delete other',
    run: async () => {
      calls.push('second');
    },
  });
  await tick();
  assert.deepEqual(calls, ['first']);
  assert.deepEqual(
    store.getState().operations.map((job) => job.status),
    ['running', 'queued'],
  );
  store.getState().dismiss(first);
  assert.equal(store.getState().operations.length, 2);
  pending.resolve();
  await tick();
  assert.deepEqual(calls, ['first', 'second']);
  assert.deepEqual(
    store.getState().operations.map((job) => job.status),
    ['succeeded', 'succeeded'],
  );
  assert.equal(store.getState().operations[0].projectId, 'repo');
  store.getState().dismiss(first);
  assert.equal(store.getState().operations.length, 1);
});

test('overlapping single and bulk requests cannot queue the same target twice', async () => {
  const store = createBackgroundOperations();
  const pending = Promise.withResolvers();
  store.getState().enqueue({
    key: 'bulk',
    resources: ['project:a', 'project:b'],
    title: 'Delete two',
    run: () => pending.promise,
  });
  assert.equal(
    store
      .getState()
      .enqueue({ key: 'single', resources: ['project:b'], title: 'Delete b', run: async () => {} }),
    null,
  );
  pending.resolve();
  await tick();
});

test('failures are retained and cannot stall later jobs or cause automatic retries', async () => {
  const store = createBackgroundOperations();
  let attempts = 0;
  store.getState().enqueue({
    key: 'delete:broken',
    title: 'Delete broken',
    run: async () => {
      attempts++;
      throw new Error('Access denied');
    },
  });
  store.getState().enqueue({
    key: 'create:next',
    title: 'Create next',
    run: async () => ({ message: 'Created next' }),
  });
  await tick();
  assert.equal(attempts, 1);
  assert.equal(store.getState().operations[0].status, 'failed');
  assert.match(store.getState().operations[0].message, /Access denied/);
  assert.equal(store.getState().operations[1].status, 'succeeded');
});
