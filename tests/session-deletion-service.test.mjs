import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionDeletionService } from '../src/main/session-deletion-service.ts';

function fixture(overrides = {}) {
  const a = { projectId: 'claude:wt', sessionId: 'a', agent: 'claude', title: 'A', cwd: '/wt' };
  const b = { ...a, sessionId: 'b', agent: 'codex', projectId: 'codex:wt', title: 'B' };
  let sessions = [a, b];
  const calls = [];
  const worktree = {
    root: '/wt',
    parentPath: '/base',
    gitDir: '/base/.git/worktrees/wt',
    branch: 'feat/test',
    identity: 'same',
    locked: false,
  };
  const service = new SessionDeletionService({
    inventory: async () => sessions,
    resolve: async (targets) =>
      sessions.filter((item) =>
        targets.some(
          (target) => item.projectId === target.projectId && item.sessionId === target.sessionId,
        ),
      ),
    inspect: async (path) => (path === '/wt' ? worktree : null),
    remove: async (wt) => calls.push(['remove', wt.root]),
    delete: async (target) => {
      calls.push(['delete', target.sessionId]);
      sessions = sessions.filter((item) => item.sessionId !== target.sessionId);
    },
    idle: async () => {},
    guard: async (_path, fn) => fn(),
    forget: async (path) => calls.push(['forget', path]),
    ...overrides,
  });
  return {
    service,
    a,
    b,
    calls,
    setSessions(value) {
      sessions = value;
    },
  };
}

test('history-only preview and deletion resolve selected identities without global inventory or Git', async () => {
  const resolutions = [];
  const f = fixture({
    inventory: async () => {
      throw new Error('Unrelated inventory must not be read');
    },
    inspect: async () => {
      throw new Error('Git must not be queried');
    },
    resolve: async (targets) => {
      resolutions.push(targets);
      return [f.a];
    },
  });
  const preview = await f.service.preview([f.a]);
  assert.deepEqual(preview.sessions, [f.a]);
  assert.deepEqual(preview.worktrees, []);
  assert.equal(preview.cleanupWarning, undefined);
  await f.service.deleteReviewed(preview.token, []);
  await f.service.finish(preview.token);
  assert.equal(resolutions.length, 2, 'fresh target validation still occurs before deletion');
  assert.deepEqual(f.calls, [['delete', 'a']]);
});

test('cleanup inspection is deduplicated for sessions sharing a cwd', async () => {
  const paths = [];
  const f = fixture({
    inspect: async (path) => {
      paths.push(path);
      return null;
    },
  });
  await f.service.preview([f.a, f.b], true);
  assert.deepEqual(paths, ['/wt']);
});

test('removing a worktree requires explicit inclusion of additional reviewed sessions', async () => {
  const f = fixture();
  const preview = await f.service.preview([f.a], true);
  assert.equal(preview.worktrees.length, 1);
  assert.deepEqual(preview.worktrees[0].additional, [f.b]);
  const result = await f.service.deleteReviewed(preview.token, [preview.worktrees[0].key]);
  assert.equal(result.deleted.length, 2);
  assert.deepEqual(f.calls, [
    ['delete', 'a'],
    ['delete', 'b'],
  ]);
  await f.service.finish(preview.token);
  assert.deepEqual(f.calls.slice(-2), [
    ['remove', '/wt'],
    ['forget', '/wt'],
  ]);
  await assert.rejects(f.service.deleteReviewed(preview.token, []));
});

test('invalid optional Git metadata keeps history-only deletion available with a visible warning', async () => {
  const f = fixture({
    inspect: async () => {
      throw new Error('Invalid Git metadata');
    },
  });
  const preview = await f.service.preview([f.a], true);
  assert.deepEqual(preview.worktrees, []);
  assert.match(preview.cleanupWarning, /Invalid Git metadata/);
  const result = await f.service.deleteReviewed(preview.token, []);
  assert.deepEqual(result.deleted, [f.a]);
  await f.service.finish(preview.token);
});

test('declining cleanup deletes only the original session and keeps the checkout', async () => {
  const f = fixture();
  const preview = await f.service.preview([f.a], true);
  const result = await f.service.deleteReviewed(preview.token, []);
  assert.deepEqual(result.deleted, [f.a]);
  await f.service.finish(preview.token);
  assert.deepEqual(f.calls, [['delete', 'a']]);
});

test('partial history failure and active terminals prevent checkout removal without rollback', async () => {
  const failed = fixture({
    delete: async (target) => {
      if (target.sessionId === 'b') throw new Error('Denied');
    },
  });
  const p = await failed.service.preview([failed.a], true);
  const result = await failed.service.deleteReviewed(p.token, [p.worktrees[0].key]);
  assert.deepEqual(result.deleted, [failed.a]);
  assert.match(result.failures.join(' '), /Denied/);
  assert.match(
    (await failed.service.finish(p.token)).retainedWorktrees.join(' '),
    /could not be deleted/,
  );
  assert.ok(!failed.calls.some((call) => call[0] === 'remove'));
  const active = fixture({
    idle: async () => {
      throw new Error('open terminal');
    },
  });
  const preview = await active.service.preview([active.a], true);
  await active.service.deleteReviewed(preview.token, [preview.worktrees[0].key]);
  assert.match(
    (await active.service.finish(preview.token)).retainedWorktrees.join(' '),
    /open terminal/,
  );
});

test('locked and ambiguous shared histories cannot be approved for cleanup', async () => {
  const f = fixture();
  f.setSessions([
    f.a,
    f.b,
    { ...f.a, sessionId: 'unknown', cwd: '/base', ownershipUncertain: true },
  ]);
  const preview = await f.service.preview([f.a], true);
  assert.match(preview.worktrees[0].blocked, /ambiguous/);
  await assert.rejects(
    f.service.deleteReviewed(preview.token, [preview.worktrees[0].key]),
    /Invalid/,
  );
  assert.deepEqual(f.calls, []);
  f.service.cancel(preview.token);
  await assert.rejects(f.service.deleteReviewed(preview.token, []), /expired/);
});

test('new histories after preview are never silently deleted or removed with a checkout', async () => {
  const f = fixture();
  const preview = await f.service.preview([f.a], true);
  f.setSessions([f.a, f.b, { ...f.a, sessionId: 'new' }]);
  const result = await f.service.deleteReviewed(preview.token, [preview.worktrees[0].key]);
  assert.equal(result.deleted.length, 2);
  const finished = await f.service.finish(preview.token);
  assert.equal(finished.removedWorktrees.length, 0);
  assert.match(finished.retainedWorktrees.join(' '), /remaining|new/i);
  assert.ok(!f.calls.some((call) => call[0] === 'remove'));
});
