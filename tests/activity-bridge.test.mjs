import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { ActivityBridge } from '../src/main/activity-bridge.ts';

async function send(endpoint, data) {
  await new Promise((resolve, reject) => {
    const socket = connect(endpoint, () => socket.end(JSON.stringify(data) + '\n'));
    socket.on('error', reject);
    socket.on('close', resolve);
  });
}

test('Unix bridge endpoint fits native path limits even with long app profile paths', async (t) => {
  if (process.platform === 'win32') return;
  const dir = await mkdtemp(join(tmpdir(), 'agent-activity-'));
  const bridge = new ActivityBridge(join(dir, 'profile'.repeat(25)));
  t.after(async () => {
    await bridge.close();
    await rm(dir, { recursive: true, force: true });
  });
  await bridge.start();
  assert.ok(Buffer.byteLength(bridge.endpoint) < 104);
});

test('bridge accepts only registered root events, rejects mismatched sessions and revokes old launches', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-activity-'));
  const bridge = new ActivityBridge(dir);
  await bridge.start();
  t.after(async () => {
    await bridge.close();
    await rm(dir, { recursive: true, force: true });
  });
  const launch = bridge.register('tab::agent', 'claude', 'session-one');
  const event = { token: launch.token, event: 'Stop', sessionId: 'session-one', data: {} };
  await send(bridge.endpoint, { ...event, token: 'wrong' });
  assert.equal(bridge.snapshot().records[0].state, 'unknown');
  await send(bridge.endpoint, { ...event, sessionId: 'other' });
  assert.equal(bridge.snapshot().records[0].state, 'unknown');
  await send(bridge.endpoint, { ...event, data: { agent_id: 'child' } });
  assert.equal(bridge.snapshot().records[0].state, 'unknown');
  await send(bridge.endpoint, { ...event, event: 'UserPromptSubmit' });
  assert.equal(bridge.snapshot().records[0].state, 'running');
  await send(bridge.endpoint, { ...event, event: 'UserPromptSubmit', turnId: 'turn-new' });
  await send(bridge.endpoint, { ...event, turnId: 'turn-old' });
  assert.equal(bridge.snapshot().records[0].state, 'running');
  await send(bridge.endpoint, { ...event, turnId: 'turn-new' });
  assert.equal(bridge.snapshot().records[0].state, 'completed');
  await send(bridge.endpoint, { ...event, event: 'SessionEnd' });
  await send(bridge.endpoint, { ...event, event: 'UserPromptSubmit' });
  assert.equal(bridge.snapshot().records[0].state, 'unknown');
  bridge.revoke(launch.token);
  await send(bridge.endpoint, { ...event, event: 'UserPromptSubmit' });
  assert.equal(bridge.snapshot().records[0].state, 'unknown');
});
