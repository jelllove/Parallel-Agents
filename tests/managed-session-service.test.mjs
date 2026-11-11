import assert from 'node:assert/strict';
import test from 'node:test';
import { ManagedSessionService } from '../src/main/managed-session-service.ts';

function fixture(overrides = {}) {
  const session = {
    id: 'one',
    agent: 'claude',
    cwd: '/repo',
    projectId: 'claude:repo',
    title: 'Native title',
  };
  let records = [];
  const bound = [];
  const options = {
    activity: () => records,
    list: async () => [session],
    samePath: async (a, b) => a === b,
    onBound: async (...args) => bound.push(args),
    // Removed generation callbacks must never run, even with old launch metadata.
    prompt: async () => {
      throw new Error('Must not read prompts');
    },
    generate: async () => {
      throw new Error('Must not call a model');
    },
    ...overrides,
  };
  const service = new ManagedSessionService(options);
  const launch = {
    terminalKey: 'tab::agent',
    launchId: 'launch',
    agent: 'claude',
    projectId: session.projectId,
    cwd: '/repo',
    generation: 'generation',
    sessionTitle: 'My chosen title',
  };
  service.register(launch);
  return {
    service,
    session,
    launch,
    bound,
    prove(generation = 'generation') {
      records = [
        { terminalKey: launch.terminalKey, agent: 'claude', generation, sessionId: session.id },
      ];
    },
  };
}

test('exact managed identity links without a title model or prompt reader', async () => {
  const f = fixture();
  assert.equal((await f.service.inspect('tab::agent', 'launch')).session, null);
  f.prove('old');
  assert.equal((await f.service.inspect('tab::agent', 'launch')).session, null);
  f.prove();
  assert.equal((await f.service.inspect('tab::agent', 'wrong')).session, null);
  assert.equal((await f.service.inspect('tab::agent', 'launch')).session.id, 'one');
  assert.equal((await f.service.inspect('tab::agent', 'launch')).session.id, 'one');
  assert.equal(f.bound.length, 1);
  f.service.close();
  assert.equal((await f.service.inspect('tab::agent', 'launch')).session, null);
});

test('concurrent inspections share binding and return the persisted manual title', async () => {
  const pending = Promise.withResolvers();
  let title = 'Native title';
  let calls = 0;
  const f = fixture({
    list: async () => [{ id: 'one', agent: 'claude', cwd: '/repo', title }],
    onBound: async () => {
      calls++;
      await pending.promise;
      title = 'My chosen title';
    },
  });
  f.prove();
  const first = f.service.inspect('tab::agent', 'launch');
  const second = f.service.inspect('tab::agent', 'launch');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  pending.resolve();
  assert.equal((await first).session.title, 'My chosen title');
  assert.equal((await second).session.title, 'My chosen title');
});

test('closing during binding drops its late response and old launch metadata cannot request a title', async () => {
  const pending = Promise.withResolvers();
  const f = fixture({ onBound: () => pending.promise });
  f.service.register({ ...f.launch, generateTitle: true });
  f.prove();
  const inspecting = f.service.inspect('tab::agent', 'launch');
  await new Promise((resolve) => setImmediate(resolve));
  f.service.cancel('tab::agent');
  pending.resolve();
  assert.equal((await inspecting).session, null);
});

test('close, checkout mismatch and duplicate native identity cannot bind another tab', async () => {
  const mismatch = fixture({ samePath: async () => false });
  mismatch.prove();
  assert.equal((await mismatch.service.inspect('tab::agent', 'launch')).session, null);
  assert.deepEqual(mismatch.bound, []);
  const f = fixture();
  f.prove();
  await f.service.inspect('tab::agent', 'launch');
  f.service.cancel('tab::agent');
  assert.equal((await f.service.inspect('tab::agent', 'launch')).session, null);
});
