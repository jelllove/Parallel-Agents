import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
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
      contents:
        "export * from './src/main/projects.ts'; export * from './src/main/sessions.ts'; export { setProjectOrder, setProjectPinned } from './src/main/config.ts';",
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

test('legacy histories remain usable when one project has invalid Git metadata', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'pa-legacy-repository-'));
  t.after(() => rm(home, { recursive: true, force: true, maxRetries: 5 }));
  const invalid = join(home, 'old-workspace');
  const healthy = join(home, 'working-workspace');
  await mkdir(join(invalid, '.git'), { recursive: true });
  await mkdir(healthy);
  const histories = [
    ['old-history', invalid, 'Old project session'],
    ['healthy-history', healthy, 'Working project session'],
  ];
  for (const [id, cwd, title] of histories) {
    const directory = join(home, '.claude', 'projects', id);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'session.jsonl'),
      JSON.stringify({
        type: 'user',
        cwd,
        timestamp: '2026-01-01T00:00:00Z',
        message: { content: title },
      }) + '\n',
    );
  }
  await writeFile(
    join(home, '.claude', 'parallel-agents.json'),
    JSON.stringify({ pinned: ['old-history'], hidden: [], lastAgentByProject: {} }),
  );
  const warning = t.mock.method(console, 'warn', () => {});
  const api = await backend(home);

  for (const instance of [api, await backend(home)]) {
    const projects = await instance.listProjects();
    assert.equal(projects.length, 2);
    assert.equal(projects.find((item) => item.id === 'claude:old-history').pinned, true);
    for (const [id, cwd, title] of histories) {
      const found = projects.find((item) => item.id === `claude:${id}`);
      assert.equal(found.realPath, cwd);
      assert.equal(found.exists, true);
      assert.equal(found.sessionCount, 1);
      assert.equal(found.worktree, undefined);
      const sessions = await instance.listSessionsForProject(found.id);
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].title, title);
      assert.equal(sessions[0].cwd, cwd);
    }
  }
  assert.equal(warning.mock.callCount(), 2);
  assert.deepEqual(await readdir(join(invalid, '.git')), []);
  await assert.rejects(readFile(join(home, '.claude', 'parallel-agents-preferences.json')), {
    code: 'ENOENT',
  });
});

test('created worktree metadata survives discovery without merging its session identity', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'pa-worktree-integration-'));
  t.after(() => rm(home, { recursive: true, force: true, maxRetries: 5 }));
  const root = join(home, 'repo');
  await mkdir(root);
  const git = (...args) =>
    promisify(execFile)('git', [
      '-C',
      root,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgSign=false',
      '-c',
      `core.hooksPath=${join(home, 'no-hooks')}`,
      ...args,
    ]);
  await git('init', '-b', 'main');
  await writeFile(join(root, 'file.txt'), 'fixture\n');
  await git('add', '.');
  await git('commit', '-m', 'Fixture');
  const api = await backend(home);
  const parent = await api.createProject({ agent: 'codex', mode: 'folder', basePath: root });
  const child = await api.createProject({
    agent: 'codex',
    mode: 'worktree',
    basePath: root,
    targetPath: join(home, 'elsewhere'),
    branch: 'feature/inline',
  });
  assert.equal(child.worktree.branch, 'feature/inline');
  assert.notEqual(child.id, parent.id);
  const history = join(home, '.codex', 'sessions');
  await mkdir(history, { recursive: true });
  await writeFile(
    join(history, 'rollout-child.jsonl'),
    JSON.stringify({
      type: 'session_meta',
      payload: { id: 'child-session', cwd: child.realPath, timestamp: '2026-10-16T08:00:00Z' },
    }) + '\n',
  );
  const restarted = await backend(home);
  const projects = await restarted.listProjects();
  assert.equal(projects.length, 2);
  assert.deepEqual(projects.find((p) => p.id === child.id).worktree, child.worktree);
  assert.equal((await restarted.listSessionsForProject(child.id))[0].projectId, child.id);
  assert.deepEqual(await restarted.listSessionsForProject(parent.id), []);
});

test('manual project ordering remains deterministic when different agents are interleaved', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'pa-interleaved-project-order-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const api = await backend(home);
  const created = [];
  for (const [name, agent] of [
    ['one', 'claude'],
    ['foreign', 'copilot'],
    ['two', 'claude'],
  ]) {
    const basePath = join(home, name);
    await mkdir(basePath);
    created.push(await api.createProject({ agent, mode: 'folder', basePath }));
  }
  await api.setProjectOrder('claude', [created[2].id, created[0].id]);
  assert.deepEqual(
    (await api.listProjects()).filter((p) => p.agent === 'claude').map((p) => p.id),
    [created[2].id, created[0].id],
  );
  await api.setProjectPinned(created[0].id, true);
  assert.deepEqual(
    (await api.listProjects()).filter((p) => p.agent === 'claude').map((p) => p.id),
    [created[0].id, created[2].id],
  );
  const restarted = await backend(home);
  assert.deepEqual(
    (await restarted.listProjects()).filter((p) => p.agent === 'claude').map((p) => p.id),
    [created[0].id, created[2].id],
  );
});

test('new project survives restart, discovers history under stable ID, and renames persist', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'pa-project-integration-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const folder = join(home, 'workspace');
  await mkdir(folder);
  const api = await backend(home);
  const created = await api.createProject({ agent: 'codex', mode: 'folder', basePath: folder });
  assert.equal(created.agent, 'codex');
  const preferencesPath = join(home, '.claude', 'parallel-agents-preferences.json');
  assert.deepEqual(JSON.parse(await readFile(preferencesPath, 'utf8')).recentFolders, [folder]);
  await assert.rejects(
    api.createProject({ agent: 'codex', mode: 'folder', basePath: join(home, 'missing') }),
    /existing absolute/,
  );
  assert.deepEqual(JSON.parse(await readFile(preferencesPath, 'utf8')).recentFolders, [folder]);
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

test('successful worktree creation remembers both base and generated folders across restart', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'pa-history-worktree-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const base = join(home, 'base');
  const target = join(home, 'worktree');
  await mkdir(base);
  const exec = promisify(execFile);
  await exec('git', ['init', '--initial-branch=main', base]);
  await exec('git', [
    '-C',
    base,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=' + join(home, 'no-hooks'),
    'commit',
    '--allow-empty',
    '-m',
    'Fixture',
  ]);
  const api = await backend(home);
  const created = await api.createProject({
    agent: 'codex',
    mode: 'worktree',
    basePath: base,
    targetPath: target,
    branch: 'feature/history',
    startPoint: 'HEAD',
  });
  const data = JSON.parse(
    await readFile(join(home, '.claude', 'parallel-agents-preferences.json'), 'utf8'),
  );
  assert.deepEqual(data.recentFolders, [created.realPath, base]);
  await api.deleteProject(data.projects[0].id);
  assert.deepEqual(
    JSON.parse(await readFile(join(home, '.claude', 'parallel-agents-preferences.json'), 'utf8'))
      .recentFolders,
    [created.realPath, base],
  );
});
