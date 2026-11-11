import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createConfigStore } from '../src/main/config-store.ts';

test('project first-seen reconciliation preserves ranks, absent IDs and concurrent manual ordering', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pa-fixed-order-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'config.json');
  const store = createConfigStore(file);
  assert.equal(typeof store.reconcileProjectOrder, 'function');
  const projects = (ids) => ids.map((id) => ({ id, agent: 'claude' }));
  await store.reconcileProjectOrder(projects(['claude:a', 'claude:b']));
  const first = await readFile(file, 'utf8');
  await store.reconcileProjectOrder(projects(['claude:b', 'claude:a']));
  assert.equal(await readFile(file, 'utf8'), first);
  await Promise.all([
    store.setProjectOrder('claude', ['claude:b', 'claude:a']),
    store.reconcileProjectOrder(projects(['claude:a', 'claude:c'])),
  ]);
  const reopened = createConfigStore(file);
  assert.deepEqual((await reopened.loadConfig()).projectOrder.claude, [
    'claude:b',
    'claude:a',
    'claude:c',
  ]);
});
