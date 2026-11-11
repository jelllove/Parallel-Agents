import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import test from 'node:test';
const require = createRequire(import.meta.url);

test('reviewed deletion closes successful identities before finish and refreshes only surviving projects', async () => {
  const target = {
    agent: 'claude',
    sessionId: 'one',
    projectId: 'removed',
    title: 'One',
    cwd: '/wt',
  };
  const preview = {
    token: 'review',
    sessions: [target],
    worktrees: [{ key: '/wt', additional: [] }],
  };
  const calls = [];
  let request;
  const state = {
    sessions: { removed: [], alias: [], unrelated: [] },
    applyDeletedSessions(items) {
      calls.push(['close', items]);
    },
    async loadProjects() {
      calls.push(['projects']);
    },
    findProject(id) {
      return id !== 'removed';
    },
    async loadSessions(id) {
      calls.push(['sessions', id]);
      if (id === 'removed') throw new Error('Unknown registered project');
    },
  };
  const result = {
    deleted: [target],
    failures: [],
    removedWorktrees: ['/wt'],
    retainedWorktrees: [],
  };
  const { code } = await transform(
    await readFile(new URL('../src/renderer/store/session-deletion.ts', import.meta.url), 'utf8'),
    { loader: 'ts', format: 'cjs' },
  );
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', code)(
    (id) => {
      if (id === './app-store.ts') return { useAppStore: { getState: () => state } };
      if (id === './background-operations.ts')
        return {
          useBackgroundOperations: {
            getState: () => ({
              enqueue(value) {
                request = value;
                return 1;
              },
            }),
          },
        };
      return require(id);
    },
    module,
    module.exports,
    {
      api: {
        sessions: {
          async deleteReviewed() {
            calls.push(['delete']);
            return structuredClone(result);
          },
          async finishDeletion() {
            calls.push(['finish']);
            return structuredClone(result);
          },
        },
      },
    },
  );
  module.exports.queueReviewedSessionDeletion(preview, ['/wt']);
  const notice = await request.run();
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['delete', 'close', 'finish', 'projects', 'sessions', 'sessions'],
  );
  assert.equal(notice.warning, false);
  assert.match(notice.message, /Worktree removed/);
  assert.ok(request.resources.includes('delete-session:claude:one'));
  assert.ok(!calls.some((call) => call[0] === 'sessions' && call[1] === 'removed'));
});
