import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createConfigStore } from '../src/main/config-store.ts';
import { validateConfig } from '../src/main/config-schema.ts';

const defaultOrder = ['copilot', 'codex', 'claude', 'gemini', 'aider'];

async function fixture(t, contents = '{}') {
  const root = await mkdtemp(join(tmpdir(), 'pa-sidebar-order-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'config.json');
  await writeFile(path, contents);
  return { store: createConfigStore(path), path };
}

test('old configuration gains the existing agent order without changing project preferences', () => {
  const config = validateConfig({
    pinned: ['claude:first'],
    projectOrder: { claude: ['claude:first'] },
  });
  assert.deepEqual(config.agentOrder, defaultOrder);
  assert.deepEqual(config.pinnedAgents, []);
  assert.deepEqual(config.pinned, ['claude:first']);
  assert.deepEqual(config.projectOrder.claude, ['claude:first']);
});

test('agent pins and manual order survive restart alongside concurrent project mutations', async (t) => {
  const { store, path } = await fixture(t);
  const order = ['gemini', 'copilot', 'codex', 'claude', 'aider'];
  await Promise.all([
    store.setAgentOrder(order),
    store.setAgentPinned('claude', true),
    store.setAgentPinned('copilot', true),
    store.setProjectPinned('claude:first', true),
    store.setProjectOrder('claude', ['claude:second', 'claude:first']),
  ]);
  order.reverse();
  const reopened = createConfigStore(path);
  assert.deepEqual(await reopened.getAgentLayout(), {
    agentOrder: ['gemini', 'copilot', 'codex', 'claude', 'aider'],
    pinnedAgents: ['claude', 'copilot'],
  });
  const config = await reopened.loadConfig();
  const snapshot = await reopened.getAgentLayout();
  snapshot.agentOrder.reverse();
  snapshot.pinnedAgents.length = 0;
  assert.deepEqual((await reopened.getAgentLayout()).pinnedAgents, ['claude', 'copilot']);
  assert.deepEqual(config.pinned, ['claude:first']);
  assert.deepEqual(config.projectOrder.claude, ['claude:second', 'claude:first']);
  await reopened.setAgentPinned('claude', false);
  assert.deepEqual((await reopened.getAgentLayout()).pinnedAgents, ['copilot']);
});

test('invalid or duplicate agent ordering and pin values fail without overwriting configuration', async (t) => {
  const { store, path } = await fixture(t);
  const before = await readFile(path, 'utf8');
  for (const order of [
    null,
    [],
    ['claude'],
    [...defaultOrder, 'claude'],
    [...defaultOrder.slice(1), 'unknown'],
  ]) {
    await assert.rejects(store.setAgentOrder(order), /agent|order/i);
  }
  await assert.rejects(store.setAgentPinned('unknown', true), /agent/i);
  await assert.rejects(store.setAgentPinned('claude', 'yes'), /boolean/i);
  for (const pinnedAgents of [null, ['unknown'], ['claude', 'claude']]) {
    assert.throws(() => validateConfig({ pinnedAgents }), /agent/i);
  }
  assert.equal(await readFile(path, 'utf8'), before);
});

test('malformed saved agent ordering is reported and preserved rather than reset', async (t) => {
  const contents = JSON.stringify({ agentOrder: ['claude', 'claude'] });
  const { store, path } = await fixture(t, contents);
  await assert.rejects(store.getAgentLayout(), /Invalid configuration/);
  await assert.rejects(store.setAgentPinned('claude', true), /Invalid configuration/);
  assert.equal(await readFile(path, 'utf8'), contents);
});
