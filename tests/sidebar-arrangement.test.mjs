import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createConfigStore } from '../src/main/config-store.ts';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pa-arrangement-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'config.json');
  return { path, store: createConfigStore(path) };
}
const project = (id, createdAt) => ({
  id: `claude:${id}`,
  agent: 'claude',
  realPath: `/repos/${id}`,
  createdAt,
});

test('upgrade resets old project ranks oldest-first once; manual moves and immutable dates survive restart', async (t) => {
  const { path, store } = await fixture(t);
  await writeFile(path, JSON.stringify({ projectOrder: { claude: ['claude:new', 'claude:old'] } }));
  let config = await store.reconcileProjectOrder([project('new', 20), project('old', 10)]);
  assert.deepEqual(config.projectOrder.claude, ['claude:old', 'claude:new']);
  await store.setProjectOrder('claude', ['claude:new', 'claude:old']);
  config = await createConfigStore(path).reconcileProjectOrder([
    project('old', 2000),
    project('new', 1),
    project('last', 30),
  ]);
  assert.deepEqual(config.projectOrder.claude, ['claude:new', 'claude:old', 'claude:last']);
});

test('new worktrees and temporarily missing projects do not move established groups', async (t) => {
  const { store } = await fixture(t);
  const a = project('a', 10),
    b = project('b', 20);
  await store.reconcileProjectOrder([b, a]);
  await store.setProjectOrder('claude', [b.id, a.id]);
  const child = { ...project('child', 1), worktree: { parentPath: b.realPath, branch: 'feature' } };
  let config = await store.reconcileProjectOrder([a, child, b]);
  assert.deepEqual(config.projectOrder.claude, [b.id, child.id, a.id]);
  config = await store.reconcileProjectOrder([a]);
  assert.deepEqual(config.projectOrder.claude, [b.id, child.id, a.id]);
});

test('default creation dates stabilize missing timestamps and late history inserts without activity sorting', async (t) => {
  const { store } = await fixture(t);
  const scope = 'claude:/repo';
  let order = await store.reconcileSessionOrder(scope, [
    { key: 'claude:b', createdAt: 20 },
    { key: 'claude:unknown' },
  ]);
  const fallback = order.createdAt['claude:unknown'];
  order = await store.reconcileSessionOrder(scope, [
    { key: 'claude:b', createdAt: 9999 },
    { key: 'claude:a', createdAt: 10 },
    { key: 'claude:unknown', createdAt: 1 },
  ]);
  assert.deepEqual(order.ids, ['claude:a', 'claude:b', 'claude:unknown']);
  assert.equal(order.createdAt['claude:unknown'], fallback);
  assert.equal(order.createdAt['claude:b'], 20);
});

test('arrangement rejects malformed identities and cannot overwrite a valid config', async (t) => {
  const { path, store } = await fixture(t);
  await store.reconcileSessionOrder('claude:/repo', [{ key: 'claude:a', createdAt: 10 }]);
  const before = await store.loadConfig();
  await assert.rejects(
    store.reconcileSessionOrder('claude:/repo', [{ key: 'codex:collision', createdAt: 20 }]),
    /identity/i,
  );
  await assert.rejects(store.reconcileSessionOrder('unknown:/repo', []), /identity/i);
  assert.deepEqual(await createConfigStore(path).loadConfig(), before);
});

test('session default chronology, manual placement, draft promotion and missing histories keep stable ranks', async (t) => {
  const { path, store } = await fixture(t);
  assert.equal(typeof store.reconcileSessionOrder, 'function');
  const scope = 'claude:/repo';
  const old = { key: 'claude:old', createdAt: 10 };
  const newer = { key: 'claude:new', createdAt: 20 };
  const draft = { key: 'draft:00000000-0000-0000-0000-000000000001', createdAt: 30 };
  let order = await store.reconcileSessionOrder(scope, [newer, draft, old]);
  assert.deepEqual(order.ids, [old.key, newer.key, draft.key]);
  order = await store.moveSessionOrder(scope, [old, newer, draft], draft.key, newer.key, 'before');
  assert.deepEqual(order.ids, [old.key, draft.key, newer.key]);
  await store.promoteSessionOrder(scope, draft.key, 'claude:native');
  const restarted = createConfigStore(path);
  order = await restarted.reconcileSessionOrder(scope, [
    old,
    { key: 'claude:native', createdAt: 500 },
    newer,
  ]);
  assert.deepEqual(order.ids, [old.key, 'claude:native', newer.key]);
  order = await restarted.reconcileSessionOrder(scope, [old]);
  assert.deepEqual(order.ids, [old.key, 'claude:native', newer.key]);
  await assert.rejects(
    restarted.moveSessionOrder(scope, [old], old.key, newer.key, 'before'),
    /available|stale/i,
  );
});
