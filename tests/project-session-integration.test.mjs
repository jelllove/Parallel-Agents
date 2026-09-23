import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

async function backend(home) {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'pa-project-backend-bundle-'));
  const outputFile = join(outputDirectory, 'backend.cjs');
  const result = await build({
    stdin: {
      contents: "export * from './src/main/projects.ts'; export * from './src/main/sessions.ts';",
      resolveDir: process.cwd(),
    },
    platform: 'node',
    format: 'cjs',
    bundle: true,
    write: false,
    plugins: [
      {
        name: 'isolated-application-home',
        setup(builder) {
          builder.onResolve({ filter: /^(electron|os)$/ }, (args) => ({
            path: args.path,
            namespace: 'test-home',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'test-home' }, (args) => ({
            contents:
              args.path === 'electron'
                ? 'export const app = { getPath: () => process.env.PARALLEL_AGENTS_TEST_HOME };'
                : 'export const homedir = () => process.env.PARALLEL_AGENTS_TEST_HOME;',
          }));
        },
      },
    ],
  });
  await writeFile(outputFile, result.outputFiles[0].text, 'utf8');
  const bundledRequire = createRequire(outputFile);
  const previousHome = process.env.PARALLEL_AGENTS_TEST_HOME;
  process.env.PARALLEL_AGENTS_TEST_HOME = home;
  try {
    return bundledRequire(outputFile);
  } finally {
    if (previousHome === undefined) delete process.env.PARALLEL_AGENTS_TEST_HOME;
    else process.env.PARALLEL_AGENTS_TEST_HOME = previousHome;
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

test('new project survives restart, discovers history under stable ID, and renames persist', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'pa-project-integration-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const folder = join(home, 'workspace');
  await mkdir(folder);
  const api = await backend(home);
  const created = await api.createProject({ agent: 'codex', mode: 'folder', basePath: folder });
  assert.equal(created.agent, 'codex');
  assert.equal((await api.listProjects()).length, 1);
  assert.deepEqual(await api.listSessionsForProject(created.id), []);
  const rollout = join(home, '.codex', 'sessions', '2026');
  await mkdir(rollout, { recursive: true });
  await writeFile(
    join(rollout, 'rollout-test.jsonl'),
    [
      {
        type: 'session_meta',
        payload: { id: 'session-one', cwd: folder, timestamp: '2026-09-10T08:00:00Z' },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Original title' }],
        },
      },
    ]
      .map(JSON.stringify)
      .join('\n') + '\n',
  );
  const discovered = await api.listProjects();
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].id, created.id);
  assert.equal(discovered[0].sessionCount, 1);
  assert.equal((await api.listSessionsForProject(created.id))[0].title, 'Original title');
  await api.renameSession(created.id, 'session-one', 'Implement workspace picker');
  const restarted = await backend(home);
  assert.equal(
    (await restarted.listSessionsForProject(created.id))[0].title,
    'Implement workspace picker',
  );
  assert.equal(
    (await restarted.createProject({ agent: 'codex', mode: 'folder', basePath: folder })).id,
    created.id,
  );
  const copilot = await restarted.createProject({
    agent: 'copilot',
    mode: 'folder',
    basePath: folder,
  });
  assert.notEqual(copilot.id, created.id);
  await rm(folder, { recursive: true });
  await restarted.deleteMissingProjects([created.id]);
  assert.equal(
    (await restarted.listProjects()).some((p) => p.id === created.id),
    false,
  );
  assert.equal(
    (await restarted.listProjects()).some((p) => p.id === copilot.id),
    true,
  );
  await assert.rejects(restarted.deleteProject(created.id), /Unknown registered project/);
});

test('Copilot subfolder projects share repository history while preserving launch directories', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'pa-copilot-subfolder-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = join(home, 'repo');
  const folder = join(root, 'packages', 'app');
  const sibling = join(root, 'packages', 'lib');
  await mkdir(folder, { recursive: true });
  await mkdir(sibling);
  await promisify(execFile)('git', ['init', root]);
  const gitRoot = (
    await promisify(execFile)('git', ['-C', root, 'rev-parse', '--show-toplevel'])
  ).stdout.trim();
  const api = await backend(home);
  const app = await api.createProject({ agent: 'copilot', mode: 'folder', basePath: folder });
  const lib = await api.createProject({ agent: 'copilot', mode: 'folder', basePath: sibling });
  const history = join(home, '.copilot', 'session-state', 'copilot-one');
  await mkdir(history, { recursive: true });
  await writeFile(
    join(history, 'events.jsonl'),
    JSON.stringify({
      type: 'session.start',
      timestamp: '2026-09-10T08:00:00Z',
      data: { sessionId: 'copilot-one', context: { cwd: folder, gitRoot } },
    }) + '\n',
  );
  const projects = await api.listProjects();
  assert.equal(projects.length, 2);
  for (const registered of [app, lib]) {
    const found = projects.find((p) => p.id === registered.id);
    assert.equal(found.realPath, registered.realPath);
    assert.equal(found.sessionCount, 1);
    assert.equal((await api.listSessionsForProject(registered.id))[0].id, 'copilot-one');
  }
  const restarted = await backend(home);
  assert.equal((await restarted.listSessionsForProject(app.id))[0].id, 'copilot-one');
  await restarted.deleteProject(app.id);
  assert.equal((await restarted.listSessionsForProject(lib.id))[0].id, 'copilot-one');
});

test('a repository and its linked worktree appear as one project with combined sessions', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'pa-worktree-merge-'));
  t.after(() => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const run = (...args) => promisify(execFile)('git', args);
  const repo = join(home, 'repo');
  await mkdir(repo);
  await run('-C', repo, 'init', '-b', 'main');
  await run('-C', repo, 'config', 'user.name', 'Merge Test');
  await run('-C', repo, 'config', 'user.email', 'merge-test@example.invalid');
  await run('-C', repo, 'config', 'commit.gpgSign', 'false');
  await run('-C', repo, 'config', 'core.hooksPath', join(home, 'no-hooks'));
  await writeFile(join(repo, 'a.txt'), 'a\n');
  await run('-C', repo, 'add', 'a.txt');
  await run('-C', repo, 'commit', '-m', 'init');
  const api = await backend(home);
  const main = await api.createProject({ agent: 'claude', mode: 'folder', basePath: repo });
  const worktree = await api.createProject({
    agent: 'claude',
    mode: 'worktree',
    basePath: repo,
    branch: 'task',
    startPoint: 'HEAD',
    targetPath: join(home, 'repo.worktree', 'task'),
  });

  const writeClaude = async (folder, id) => {
    const dir = join(home, '.claude', 'projects', folder.replace(/[:\\/.]/g, '-'));
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, `${id}.jsonl`),
      JSON.stringify({
        type: 'user',
        cwd: folder,
        timestamp: '2026-09-10T08:00:00Z',
        message: { content: id },
      }) + '\n',
    );
  };
  await writeClaude(main.realPath, 'main-session');
  await writeClaude(worktree.realPath, 'worktree-session');

  const projects = (await api.listProjects()).filter((p) => p.agent === 'claude');
  assert.equal(projects.length, 1);
  assert.equal(projects[0].displayName, 'repo');
  assert.equal(projects[0].worktreeCount, 2);
  const sessions = await api.listSessionsForProject(projects[0].id);
  assert.deepEqual(sessions.map((s) => s.id).sort(), ['main-session', 'worktree-session']);
  const fromWorktree = sessions.find((s) => s.id === 'worktree-session');
  assert.equal(fromWorktree.cwd, worktree.realPath);
});
