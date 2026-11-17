import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';
import { readClaudeSessionMeta } from '../src/main/session-metadata.ts';
import { SessionDeletionService } from '../src/main/session-deletion-service.ts';
import { withFreshHistory } from '../src/main/history-read-context.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';

// Exercise production ownership mapping without loading the native PTY singleton or a real CLI home.
async function runtime(projects, sessions, worktree, registrations = []) {
  const require = createRequire(import.meta.url);
  const { code } = await transform(
    await readFile(new URL('../src/main/session-deletion-runtime.ts', import.meta.url), 'utf8'),
    { loader: 'ts', format: 'cjs' },
  );
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (id) => {
      if (id === './projects.ts')
        return {
          listProjects: async () => projects,
          resolveHistoryProjectPath: async (id) =>
            projects.find((project) => project.id === id).realPath,
        };
      if (id === './sessions.ts')
        return {
          listSessionsForProject: async (id) => sessions[id],
          deleteSession: () => assert.fail('Read-only preview must not delete histories'),
        };
      if (id === './worktrees.ts') return { inspectLinkedWorktree: async () => worktree };
      if (id === './preferences-store.ts')
        return { preferences: { read: async () => ({ projects: registrations }) } };
      if (id === './session-checkout-scope.ts')
        return require('../src/main/session-checkout-scope.ts');
      if (id === './session-deletion-service.ts') return { SessionDeletionService };
      if (id === './history-read-context.ts') return { withFreshHistory };
      if (id.startsWith('./')) return {};
      return require(id);
    },
    module,
    module.exports,
  );
  return module.exports.sessionDeletion;
}

test('runtime excludes registered different-checkout empty histories despite a lossy primary-repo fallback', async (t) => {
  const root = await realpath(
    await mkdtemp(join(process.cwd(), 'reports', 'cleanup-runtime-scope-')),
  );
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const base = join(root, 'base');
  const checkout = join(root, 'checkout');
  const other = join(root, 'other-checkout');
  await mkdir(base);
  await mkdir(checkout);
  await mkdir(other);
  await promisify(execFile)('git', ['init', '--initial-branch=main', other]);
  const historyId = `claude:${other.replace(/[^a-zA-Z0-9]/g, '-')}`;
  const target = {
    projectId: 'claude:target',
    id: 'target',
    agent: 'claude',
    title: 'Target',
    cwd: checkout,
  };
  const empty = {
    projectId: historyId,
    id: 'empty',
    agent: 'claude',
    title: '(no user message)',
    cwd: null,
  };
  const projects = [
    { id: target.projectId, realPath: checkout },
    { id: historyId, realPath: join(base, 'guessed-other') },
  ];
  const registered = {
    id: `claude:manual:${other}`,
    agent: 'claude',
    realPath: other,
    historyPath: other,
  };
  const service = await runtime(
    projects,
    { [target.projectId]: [target], [historyId]: [empty] },
    { root: checkout, parentPath: base, branch: 'feat/target', identity: 'fixture', locked: false },
    [registered],
  );
  const preview = await service.preview(
    [{ projectId: target.projectId, sessionId: target.id }],
    true,
  );
  assert.equal(preview.worktrees[0].blocked, undefined);
  assert.deepEqual(preview.worktrees[0].additional, []);
  service.cancel(preview.token);
});

test('root cwd resolves header-only history ownership while genuine missing cwd stays a named blocker', async (t) => {
  const root = await mkdtemp(join(process.cwd(), 'reports', 'cleanup-ownership-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const base = join(root, 'base');
  const checkout = join(root, 'checkout');
  const nested = join(checkout, 'release-agent');
  await mkdir(base);
  await mkdir(nested, { recursive: true });
  const history = join(root, 'header-only.jsonl');
  await writeFile(history, JSON.stringify({ type: 'system', cwd: base }) + '\n');
  const target = {
    projectId: 'claude:wt',
    id: 'target',
    agent: 'claude',
    title: 'Target',
    cwd: checkout,
  };
  const header = {
    projectId: 'claude:base',
    id: 'header',
    agent: 'claude',
    ...(await readClaudeSessionMeta(history)),
  };
  const additional = {
    projectId: 'copilot:wt',
    id: 'nested',
    agent: 'copilot',
    title: 'Nested Copilot',
    cwd: nested,
  };
  const projects = [
    { id: 'claude:wt', realPath: checkout },
    { id: 'claude:base', realPath: base },
    { id: 'copilot:wt', realPath: checkout },
  ];
  const sessions = { 'claude:wt': [target], 'claude:base': [header], 'copilot:wt': [additional] };
  const service = await runtime(projects, sessions, {
    root: checkout,
    parentPath: base,
    branch: 'task/test',
    identity: 'fixture',
    locked: false,
  });
  const preview = await service.preview(
    [{ projectId: target.projectId, sessionId: target.id }],
    true,
  );
  assert.equal(preview.worktrees[0].blocked, undefined);
  assert.deepEqual(
    preview.worktrees[0].additional.map((item) => item.sessionId),
    ['nested'],
  );
  service.cancel(preview.token);
  sessions['claude:base'].push({ ...header, id: 'unknown', title: 'Missing checkout', cwd: null });
  const blocked = await service.preview(
    [{ projectId: target.projectId, sessionId: target.id }],
    true,
  );
  assert.equal(blocked.worktrees[0].blockers[0].sessionId, 'unknown');
  assert.equal(blocked.worktrees[0].blockers[0].ownershipUncertain, true);
  assert.match(blocked.worktrees[0].blocked, /Missing checkout/);
  service.cancel(blocked.token);
});
