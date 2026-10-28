import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

async function createStore(api) {
  api.config ??= {};
  if (!api.config.getAgentLayout) {
    const readTree = api.config.getSidebarTree;
    let reading;
    api.config.getSidebarTree = () => (reading = readTree());
    api.config.getAgentLayout = async () => ({
      agentOrder: (await reading).agentOrder ?? ['copilot', 'codex', 'claude', 'gemini', 'aider'],
      pinnedAgents: [],
    });
  }
  const result = await build({
    entryPoints: ['src/renderer/store/app-store.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [
      {
        name: 'command-icons-without-images',
        setup(builder) {
          builder.onResolve({ filter: /icons\/agentIcons$/ }, () => ({
            path: 'icons',
            namespace: 'commands',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'commands' }, () => ({
            contents:
              'export const startCommandFor=id=>id; export const resumeCommandFor=(id,s)=>`${id} resume ${s}`; export const extraPathFor=()=>[];',
          }));
        },
      },
    ],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', 'document', result.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
    { api },
    { documentElement: { style: { setProperty() {} } } },
  );
  return module.exports.useAppStore;
}

test('sidebar changes restore after restart without opening any terminal', async () => {
  let saved = { collapsedAgents: [], expandedProjects: [], showHidden: false };
  const api = {
    config: {
      getSidebarTree: async () => structuredClone(saved),
      setSidebarTree: async (tree) => {
        saved = structuredClone(tree);
      },
    },
  };
  const store = await createStore(api);
  assert.equal(typeof store.getState().loadSidebarTree, 'function');
  await store.getState().loadSidebarTree();
  await Promise.all([
    store.getState().toggleAgentGroup('copilot'),
    store.getState().setProjectExpanded('codex:c:/repo', true),
    store.getState().setShowHidden(true),
  ]);
  const restarted = await createStore(api);
  await restarted.getState().loadSidebarTree();
  assert.deepEqual(restarted.getState().collapsedAgents, ['copilot']);
  assert.deepEqual(restarted.getState().expandedProjects, ['codex:c:/repo']);
  assert.equal(restarted.getState().showHidden, true);
  assert.deepEqual(restarted.getState().openTabs, []);
  await restarted.getState().setProjectExpanded('codex:c:/repo', false);
  assert.deepEqual(saved.expandedProjects, []);
});

test('Agent sections reorder in both directions and persist the final order with tree state', async () => {
  let saved = {
    agentOrder: ['copilot', 'codex', 'claude', 'gemini', 'aider'],
    collapsedAgents: ['gemini'],
    expandedProjects: ['codex:c:/repo'],
    showHidden: true,
  };
  let writes = 0;
  const api = {
    config: {
      getSidebarTree: async () => structuredClone(saved),
      setSidebarTree: async (tree) => {
        writes++;
        saved = structuredClone(tree);
      },
    },
  };
  const store = await createStore(api);
  assert.equal(typeof store.getState().reorderAgentGroups, 'function');
  await store.getState().loadSidebarTree();
  await store.getState().reorderAgentGroups('copilot', 'aider', 'after');
  assert.deepEqual(saved.agentOrder, ['codex', 'claude', 'gemini', 'aider', 'copilot']);
  await store.getState().reorderAgentGroups('gemini', 'codex', 'before');
  assert.deepEqual(saved.agentOrder, ['gemini', 'codex', 'claude', 'aider', 'copilot']);
  await store.getState().reorderAgentGroups('gemini', 'gemini', 'after');
  await store.getState().reorderAgentGroups('gemini', 'codex', 'before');
  assert.equal(writes, 2, 'self drops and unchanged positions do not write');
  await store.getState().toggleAgentGroup('codex');
  const restarted = await createStore(api);
  await restarted.getState().loadSidebarTree();
  assert.deepEqual(restarted.getState().agentOrder, [
    'gemini',
    'codex',
    'claude',
    'aider',
    'copilot',
  ]);
  assert.deepEqual(restarted.getState().collapsedAgents, ['gemini', 'codex']);
  assert.deepEqual(restarted.getState().expandedProjects, ['codex:c:/repo']);
  assert.equal(restarted.getState().showHidden, true);
  assert.deepEqual(restarted.getState().openTabs, []);
});

test('failed Agent-order saves retain the requested order and expose a retryable error', async () => {
  let failing = true;
  let saved;
  const store = await createStore({
    config: {
      getSidebarTree: async () => ({
        agentOrder: ['copilot', 'codex', 'claude', 'gemini', 'aider'],
        collapsedAgents: [],
        expandedProjects: [],
        showHidden: false,
      }),
      setSidebarTree: async (tree) => {
        if (failing) throw new Error('disk full');
        saved = structuredClone(tree);
      },
    },
  });

  test('shared agent arrangement restores pins and rejects keyboard or drag moves across pin partitions', async () => {
    const order = ['copilot', 'codex', 'claude', 'gemini', 'aider'];
    let writes = 0;
    const store = await createStore({
      config: {
        getSidebarTree: async () => ({
          agentOrder: ['aider', 'gemini', 'claude', 'codex', 'copilot'],
          collapsedAgents: ['codex'],
          expandedProjects: ['repo'],
          showHidden: true,
        }),
        getAgentLayout: async () => ({ agentOrder: order, pinnedAgents: ['claude', 'gemini'] }),
        setSidebarTree: async () => {
          writes++;
        },
      },
    });
    await store.getState().loadSidebarTree();
    assert.deepEqual(store.getState().agentOrder, order, 'upstream arrangement is authoritative');
    assert.deepEqual(store.getState().pinnedAgents, ['claude', 'gemini']);
    await assert.rejects(
      store.getState().reorderAgentGroups('claude', 'copilot', 'before'),
      /pinned section/,
    );
    assert.equal(writes, 0);
    await store.getState().reorderAgentGroups('gemini', 'claude', 'before');
    assert.equal(writes, 1);
    assert.deepEqual(store.getState().collapsedAgents, ['codex']);
    assert.deepEqual(store.getState().expandedProjects, ['repo']);
  });
  assert.equal(typeof store.getState().reorderAgentGroups, 'function');
  await store.getState().loadSidebarTree();
  await store.getState().reorderAgentGroups('aider', 'copilot', 'before');
  assert.match(store.getState().sidebarTreeError, /disk full/);
  assert.equal(store.getState().agentOrder[0], 'aider');
  failing = false;
  await store.getState().saveSidebarTree();
  assert.equal(saved.agentOrder[0], 'aider');
  assert.equal(store.getState().sidebarTreeError, null);
});
test('sidebar load and save failures are visible and can be retried', async () => {
  let failLoad = true;
  let failSave = true;
  const store = await createStore({
    config: {
      getSidebarTree: async () => {
        if (failLoad) throw new Error('unreadable config');
        return { collapsedAgents: [], expandedProjects: [], showHidden: false };
      },
      setSidebarTree: async () => {
        if (failSave) throw new Error('disk full');
      },
    },
  });
  assert.equal(typeof store.getState().loadSidebarTree, 'function');
  await store.getState().loadSidebarTree();
  assert.equal(store.getState().sidebarTreeLoaded, false);
  assert.match(store.getState().sidebarTreeError, /unreadable config/);
  failLoad = false;
  await store.getState().loadSidebarTree();
  await store.getState().toggleAgentGroup('gemini');
  assert.match(store.getState().sidebarTreeError, /disk full/);
  assert.deepEqual(store.getState().collapsedAgents, ['gemini']);
  failSave = false;
  await store.getState().saveSidebarTree();
  assert.equal(store.getState().sidebarTreeError, null);
});

test('sidebar hydration is shared and cannot be overwritten by early controls', async () => {
  const pending = Promise.withResolvers();
  let reads = 0;
  let writes = 0;
  const saved = {
    collapsedAgents: ['copilot'],
    expandedProjects: ['codex:c:/repo'],
    showHidden: true,
  };
  const store = await createStore({
    config: {
      getSidebarTree: () => {
        reads++;
        return pending.promise;
      },
      setSidebarTree: async () => {
        writes++;
      },
    },
  });
  const first = store.getState().loadSidebarTree();
  const duplicate = store.getState().loadSidebarTree();
  await store.getState().toggleAgentGroup('gemini');
  assert.deepEqual(store.getState().collapsedAgents, []);
  assert.equal(writes, 0);
  pending.resolve(saved);
  await Promise.all([first, duplicate]);
  assert.equal(reads, 1);
  assert.deepEqual(store.getState().collapsedAgents, ['copilot']);
  assert.deepEqual(store.getState().expandedProjects, saved.expandedProjects);
  assert.equal(store.getState().sidebarTreeError, null);
});

test('late sidebar save errors do not overwrite a newer successful save', async () => {
  const pending = Promise.withResolvers();
  let writes = 0;
  const store = await createStore({
    config: {
      getSidebarTree: async () => ({
        collapsedAgents: [],
        expandedProjects: [],
        showHidden: false,
      }),
      setSidebarTree: () => (++writes === 1 ? pending.promise : Promise.resolve()),
    },
  });
  assert.equal(typeof store.getState().loadSidebarTree, 'function');
  await store.getState().loadSidebarTree();
  const first = store.getState().toggleAgentGroup('copilot');
  await store.getState().setProjectExpanded('codex:c:/repo', true);
  pending.reject(new Error('older write failed'));
  await first;
  assert.equal(store.getState().sidebarTreeError, null);
});

test('single session project opens a bound tab and renames without restarting it', async () => {
  let session = { id: 'one', projectId: 'codex:repo', agent: 'codex', title: 'Original' };
  const killed = [];
  const api = {
    sessions: {
      listForProject: async () => [session],
      rename: async (_project, _id, title) => {
        session = { ...session, title };
        return title;
      },
    },
    config: { setLastAgent: async () => {} },
    git: { status: async () => null, watch: async () => {} },
    pty: { kill: async (id) => killed.push(id) },
  };
  const store = await createStore(api);
  const project = {
    id: 'codex:repo',
    agent: 'codex',
    dirName: 'repo',
    realPath: 'C:\\repo',
    displayName: 'Repo',
    exists: true,
    sessionCount: 1,
  };
  store.setState({ projects: [project] });
  await store.getState().openProjectFromList(project.id);
  const tab = store.getState().activeTabId;
  assert.equal(store.getState().tabSessionId[tab], 'one');
  await store.getState().renameSession(project.id, 'one', 'Renamed');
  assert.equal(store.getState().sessions[project.id][0].title, 'Renamed');
  assert.equal(store.getState().activeTabId, tab);
  assert.deepEqual(killed, []);
  store.getState().closeTab(tab);
  await store.getState().openProjectFromList(project.id);
  assert.equal(store.getState().sessions[project.id][0].title, 'Renamed');
});

test('new project requires explicit session association and avoids duplicate resume', async () => {
  let sessions = [];
  const project = {
    id: 'codex:manual:repo',
    agent: 'codex',
    dirName: 'manual:repo',
    realPath: 'C:\\repo',
    displayName: 'Repo',
    exists: true,
    sessionCount: 0,
  };
  const store = await createStore({
    projects: { create: async () => project },
    sessions: { listForProject: async () => sessions },
    config: { setLastAgent: async () => {} },
  });
  await store
    .getState()
    .createProject({ agent: 'codex', mode: 'folder', basePath: project.realPath });
  assert.equal(store.getState().pendingInitialCommand[project.id].command, 'codex');
  assert.equal(store.getState().selectedProjectId, project.id);
  sessions = [{ id: 'new-session', projectId: project.id, agent: 'codex', title: 'New task' }];
  await store.getState().loadSessions(project.id);
  assert.equal(store.getState().tabSessionId[project.id], null);
  await store.getState().openSessionTab(project.id, sessions[0]);
  assert.equal(store.getState().sessionLinkRequest.sessionId, 'new-session');
  assert.equal(store.getState().openTabs.length, 1);
  store.getState().linkSession(project.id, 'new-session');
  assert.equal(store.getState().tabSessionId[project.id], 'new-session');
  assert.deepEqual(store.getState().tabSessionBaseline, {});
  await store.getState().openSessionTab(project.id, sessions[0]);
  assert.equal(store.getState().openTabs.length, 1);
});

test('external history arriving before the launched session cannot claim the terminal', async () => {
  let sessions = [];
  const store = await createStore({
    config: { setLastAgent: async () => {} },
    sessions: { listForProject: async () => sessions },
  });
  await store.getState().openTabWithAgent('codex:repo', 'codex', 'codex');
  sessions = [{ id: 'external', agent: 'codex', title: 'External' }];
  await store.getState().loadSessions('codex:repo');
  assert.equal(store.getState().tabSessionId['codex:repo'], null);
  sessions.push({ id: 'actual', agent: 'codex', title: 'Actual' });
  await store.getState().loadSessions('codex:repo');
  assert.equal(store.getState().tabSessionId['codex:repo'], null);
  store.getState().linkSession('codex:repo', 'actual');
  assert.equal(store.getState().tabSessionId['codex:repo'], 'actual');
});

test('concurrently opening sessions preserves both tabs and deduplicates the same session', async () => {
  const store = await createStore({
    config: { setLastAgent: async () => {} },
  });
  const session = { id: 'first', agent: 'codex', projectId: 'codex:repo', title: 'First' };
  await Promise.all([
    store.getState().openSessionTab(session.projectId, session),
    store.getState().openSessionTab(session.projectId, { ...session, id: 'second' }),
    store.getState().openSessionTab(session.projectId, session),
  ]);
  assert.equal(store.getState().openTabs.length, 2);
  assert.deepEqual(Object.values(store.getState().tabSessionId), ['first', 'second']);
  await store.getState().openSessionTab('codex:another-project', session);
  assert.equal(store.getState().openTabs.length, 2);
});

test('reordering a project moves its worktrees as one group', async () => {
  const root = { id: 'root', agent: 'codex', realPath: 'C:\\root' };
  const child = {
    id: 'child',
    agent: 'codex',
    realPath: 'C:\\child',
    worktree: { parentPath: root.realPath, branch: 'feature' },
  };
  const target = { id: 'target', agent: 'codex', realPath: 'C:\\target' };
  const projects = [child, root, target];
  let order;
  const store = await createStore({
    projects: {
      list: async () => projects,
      setOrder: async (_agent, ids) => {
        order = ids;
      },
    },
  });
  store.setState({ projects });
  await store.getState().reorderProjects('codex', root.id, target.id);
  assert.deepEqual(order, [target.id, child.id, root.id]);
});
