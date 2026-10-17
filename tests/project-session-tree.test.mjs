import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { create } from 'zustand';

const root = {
  id: 'codex:root',
  agent: 'codex',
  dirName: 'root',
  realPath: 'C:\\Repo',
  displayName: 'Repo',
  exists: true,
  pinned: false,
  hidden: false,
  sessionCount: 1,
};
const child = {
  ...root,
  id: 'codex:child',
  realPath: 'C:\\Elsewhere\\feature',
  displayName: 'feature',
  worktree: { parentPath: 'c:/repo/', branch: 'feature/list' },
};
const session = (project, id, timestamp) => ({
  id,
  projectId: project.id,
  agent: project.agent,
  title: id,
  timestamp,
  cwd: project.realPath,
  gitBranch: null,
  version: null,
});

async function bundle(state = {}) {
  const result = await build({
    stdin: {
      contents: `
        export { Sidebar } from './src/renderer/components/Sidebar';
        export { SessionList } from './src/renderer/components/SessionList';
        export { useAppStore } from './src/renderer/store/app-store';
      `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    jsx: 'automatic',
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
    define: { 'import.meta.env.BASE_URL': '"/"' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    (id) =>
      id === 'zustand'
        ? { create: (initialize) => create((...args) => ({ ...initialize(...args), ...state })) }
        : createRequire(import.meta.url)(id),
    module,
    module.exports,
  );
  return module.exports;
}

test('sidebar has one project tree and no separate recent-sessions panel', async () => {
  const { Sidebar } = await bundle({ projects: [child, root] });
  const html = renderToStaticMarkup(createElement(Sidebar, { onAbout() {} }));
  assert.doesNotMatch(html, /Recent Sessions|data-panel-group-direction="vertical"/);
  assert.equal((html.match(/class="[^"]*project-item/g) ?? []).length, 1);
  assert.match(html, /aria-label="Expand Repo"/);
});

test('project rows show a line folder and name, with the full path only in the tooltip', async () => {
  const { Sidebar } = await bundle({ projects: [root] });
  const html = renderToStaticMarkup(createElement(Sidebar, { onAbout() {} }));
  assert.match(html, /class="project-folder-icon"/);
  assert.doesNotMatch(html, /<img[^>]+class="project-icon"/);
  assert.match(html, /title="C:\\Repo"/);
  assert.doesNotMatch(html, />C:\\Repo</);
  assert.match(html, /aria-label="Expand Repo"/);
});

test('agent sections are keyboard-accessible header blocks with remembered disclosure state', async () => {
  const { Sidebar } = await bundle({
    projects: [root],
    sidebarTreeLoaded: true,
    collapsedAgents: ['codex'],
  });
  const html = renderToStaticMarkup(createElement(Sidebar, { onAbout() {} }));
  assert.match(html, /<button[^>]*class="agent-group-toggle/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /class="project-folder-icon"/);
});

test('Agent headers render saved order and enable dragging only after hydration', async () => {
  const agentOrder = ['gemini', 'aider', 'codex', 'claude', 'copilot'];
  for (const loaded of [false, true]) {
    const { Sidebar } = await bundle({ agentOrder, sidebarTreeLoaded: loaded });
    const html = renderToStaticMarkup(createElement(Sidebar, { onAbout() {} }));
    assert.deepEqual(
      [...html.matchAll(/data-agent="([^"]+)"/g)].map((match) => match[1]),
      agentOrder,
    );
    assert.equal((html.match(new RegExp(`<div[^>]*draggable="${loaded}"`, 'g')) ?? []).length, 5);
    assert.match(html, /aria-keyshortcuts="Alt\+ArrowUp Alt\+ArrowDown"/);
  }
});

test('inline sessions use their explicit project group, not the selected project', async () => {
  const { SessionList } = await bundle({
    selectedProjectId: 'unrelated',
    projects: [root, child],
    sessions: {
      [root.id]: [session(root, 'base session', 10)],
      [child.id]: [session(child, 'worktree session', 20)],
      unrelated: [session(root, 'unrelated session', 30)],
    },
  });
  const html = renderToStaticMarkup(createElement(SessionList, { projects: [root, child] }));
  assert.match(html, /base session/);
  assert.match(html, /worktree session/);
  assert.match(html, /feature\/list/);
  assert.match(html, /class="session-branch-icon"/);
  assert.doesNotMatch(html, /unrelated session/);
  assert.ok(html.indexOf('worktree session') < html.indexOf('base session'));
});

test('grouping preserves source identities, hidden filtering and absent parents', async () => {
  const { groupProjectTrees, collectProjectSessions } =
    await import('../src/shared/project-tree.ts');
  const otherAgent = { ...child, id: 'claude:child', agent: 'claude' };
  const groups = groupProjectTrees([child, root, otherAgent]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].project, root);
  assert.deepEqual(groups[0].projects, [child, root]);
  assert.equal(groups[0].name, 'Repo');
  assert.equal(groups[1].project, otherAgent);
  assert.equal(groups[1].name, 'repo');
  assert.equal(groupProjectTrees([{ ...child, hidden: true }, root])[0].projects.length, 1);
  assert.equal(groupProjectTrees([{ ...child, hidden: true }, root], true)[0].projects.length, 2);
  const rows = collectProjectSessions([root, child], {
    [root.id]: [session(root, 'base', 1)],
    [child.id]: [session(child, 'worktree', 2)],
  });
  assert.deepEqual(
    rows.map((row) => row.project.id),
    [child.id, root.id],
  );
  assert.equal(rows[0].session.projectId, child.id);
  const duplicate = session(child, 'same-history', 3);
  assert.deepEqual(
    collectProjectSessions([root, child], {
      [root.id]: [duplicate],
      [child.id]: [duplicate],
    }).map((row) => row.project.id),
    [child.id],
  );
});

test('missing worktree sessions remain visible but cannot be resumed', async () => {
  const missing = { ...child, exists: false };
  const { SessionList } = await bundle({
    sessions: { [child.id]: [session(child, 'missing session', 20)] },
  });

  test('a pinned worktree promotes its whole group while keeping original project identities', async () => {
    const { groupProjectTrees } = await import('../src/shared/project-tree.ts');
    const other = { ...root, id: 'codex:other', realPath: 'C:\\Other', displayName: 'Other' };
    const pinnedChild = { ...child, pinned: true };
    const trees = groupProjectTrees([other, pinnedChild, root]);
    assert.equal(trees[0].project, root);
    assert.equal(trees[0].pinned, true);
    assert.equal(root.pinned, false);
    const { Sidebar } = await bundle({
      projects: [other, pinnedChild, root],
      sidebarTreeLoaded: true,
    });
    const html = renderToStaticMarkup(createElement(Sidebar, { onAbout() {} }));
    assert.match(html, /aria-label="Unpin project Repo" aria-pressed="true"/);
  });
  const html = renderToStaticMarkup(createElement(SessionList, { projects: [missing] }));
  assert.match(html, /class="session-open" disabled=""/);
  assert.match(html, /Directory not found/);
  assert.match(html, /Rename missing session/);
});
