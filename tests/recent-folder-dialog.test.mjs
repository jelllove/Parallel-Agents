import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { transform } from 'esbuild';
const require = createRequire(import.meta.url);
const flush = () => new Promise((resolve) => setImmediate(resolve));
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...[tree.props?.children].flat(Infinity).flatMap((child) => nodes(child, predicate)),
  ];
}
const byLabel = (tree, label) => nodes(tree, (node) => node.props?.['aria-label'] === label)[0];
const button = (tree, text) =>
  nodes(tree, (node) => node.type === 'button' && node.props.children === text)[0];
const mode = (tree, value) =>
  nodes(tree, (node) => node.type === 'button' && node.props['aria-pressed'] !== undefined)[
    value === 'folder' ? 0 : 1
  ];
const dropdown = (tree) => nodes(tree, (node) => node.type === 'RecentFolderDropdown')[0];
const submit = (h) =>
  nodes(h.render(), (node) => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
const name = (h, value = 'My session') =>
  byLabel(h.render(), 'Session Title').props.onChange({ target: { value } });

async function harness({
  folders = ['C:\\repo', 'C:\\other'],
  failure,
  queueProjectCreation = () => 1,
  workspace = {},
  agent = 'codex',
  sourceProject,
  repository,
  clock = () => new Date(2026, 10, 11, 12),
} = {}) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let closed = 0;
  const saves = [];
  const settings = [];
  const repo = repository ?? {
    info: {
      exists: true,
      isGit: true,
      hasHead: true,
      currentBranch: 'main',
      defaultRef: 'refs/heads/main',
      refs: [{ value: 'refs/heads/main', label: 'main', kind: 'local' }],
    },
    loading: false,
  };
  const react = {
    useCallback: (callback) => callback,
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [
        slots[i].value,
        (value) => {
          slots[i].value = typeof value === 'function' ? value(slots[i].value) : value;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      slots[i] ??= { current: initial };
      return slots[i];
    },
    useEffect(effect) {
      const i = cursor++;
      if (!slots[i]) {
        slots[i] = {};
        effects.push(() => {
          slots[i].cleanup = effect();
        });
      }
    },
  };
  const { code } = await transform(
    await readFile(
      new URL('../src/renderer/components/NewProjectDialog.tsx', import.meta.url),
      'utf8',
    ),
    { loader: 'tsx', format: 'cjs', jsx: 'automatic' },
  );
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', 'Date', code)(
    (id) => {
      if (id === 'react') return react;
      if (id === './NewProjectDialog.css') return {};
      if (id === '../hooks/use-workspace-repository') return { useWorkspaceRepository: () => repo };
      if (id === '../new-session-branch') return require('../src/renderer/new-session-branch.ts');
      if (id === '../store/app-store')
        return {
          useAppStore: (select) =>
            select({
              agents: [{ id: agent, displayName: agent === 'claude' ? 'Claude Code' : 'Codex' }],
              showAgentLaunchSettings: (value) => settings.push(value),
            }),
        };
      if (id === '../store/workspace-operations') return { queueProjectCreation };
      if (id === '../../shared/session-presentation')
        return require('../src/shared/session-presentation.ts');
      if (id.startsWith('./')) {
        const component = id.slice(2);
        return { [component]: component };
      }
      return require(id);
    },
    module,
    module.exports,
    {
      api: {
        workspace: {
          getMode: async () => 'folder',
          setMode: async (value) => saves.push(value),
          getRecentFolders: async () => {
            if (failure) throw failure;
            return folders;
          },
          ...workspace,
        },
        dialog: { pickDirectory: async () => 'C:\\browsed' },
      },
    },
    class extends Date {
      constructor() {
        super(clock().getTime());
      }
    },
  );
  const h = {
    render() {
      cursor = 0;
      effects = [];
      const tree = module.exports.NewProjectDialog({
        agent,
        sourceProject,
        onClose: () => closed++,
      });
      effects.forEach((effect) => effect());
      return tree;
    },
    saves,
    settings,
    repo,
    closed: () => closed,
    unmount: () => slots.forEach((slot) => slot.cleanup?.()),
  };
  h.render();
  await flush();
  return h;
}

test('reference layout has provider badge, compact settings, segmented modes and no auto-title controls', async () => {
  const h = await harness({ agent: 'claude' });
  const tree = h.render();
  assert.match(tree.props.className, /new-session-dialog/);
  assert.equal(nodes(tree, (n) => n.type === 'header').length, 1);
  assert.equal(nodes(tree, (n) => n.type === 'footer').length, 1);
  assert.equal(
    nodes(tree, (n) => n.props.className === 'new-session-provider')[0].props.children,
    'Claude Code',
  );
  assert.equal(mode(tree, 'folder').props['aria-pressed'], true);
  assert.equal(mode(tree, 'worktree').props['aria-pressed'], false);
  const title = byLabel(tree, 'Session Title');
  assert.equal(title.props.required, true);
  assert.equal(title.props.maxLength, 120);
  assert.equal(nodes(tree, (n) => n.type === 'input' && n.props.type === 'checkbox').length, 0);
  byLabel(tree, 'Configure Claude Code approval mode and model').props.onClick();
  assert.deepEqual(h.settings, ['claude']);
});
test('creation form keeps essential fields without redundant small-text captions', async () => {
  const h = await harness({
    sourceProject: { realPath: 'C:\\repo' },
    workspace: { getMode: async () => 'worktree' },
  });
  const tree = h.render();
  assert.equal(nodes(tree, (n) => n.type === 'small').length, 0);
  const header = nodes(tree, (n) => n.type === 'header')[0];
  assert.equal(nodes(header, (n) => n.type === 'p').length, 0);
  assert.equal(nodes(tree, (n) => n.props.className === 'new-session-isolated').length, 0);
  assert.equal(
    nodes(tree, (n) => n.props.className?.startsWith('new-session-readiness')).length,
    0,
  );
  assert.equal(byLabel(tree, 'Base Branch').props.value, 'refs/heads/main');
  assert.ok(byLabel(tree, 'New branch'));
  assert.ok(nodes(tree, (n) => n.props.className === 'new-session-path-preview').length);
  assert.equal(byLabel(tree, 'Session Title').props.required, true);
  assert.ok(button(tree, 'Enter path manually'));
  assert.ok(button(tree, 'Edit directory…'));
  assert.ok(button(tree, 'Cancel'));
});

test('simplified dialog still explains unavailable folders and repository checks', async () => {
  const missing = await harness({
    repository: { info: { exists: false }, loading: false },
    sourceProject: { realPath: 'C:\\missing' },
  });
  assert.ok(
    nodes(missing.render(), (n) => n.props.role === 'alert').some((n) =>
      String(n.props.children).includes('Project folder is unavailable'),
    ),
  );
  const checking = await harness({
    repository: { loading: true },
    sourceProject: { realPath: 'C:\\repo' },
    workspace: { getMode: async () => 'worktree' },
  });
  assert.ok(
    nodes(checking.render(), (n) => n.props.role === 'status').some(
      (n) => n.props.children === 'Checking repository…',
    ),
  );
  const empty = await harness({
    repository: { loading: false },
    workspace: { getMode: async () => 'worktree' },
  });
  assert.equal(
    nodes(empty.render(), (n) => n.props.role === 'alert').length,
    0,
    'an untouched empty folder selection is not an error',
  );
});

test('repository dropdown fills path without submitting and manual entry survives history failure', async () => {
  let calls = 0;
  const h = await harness({ queueProjectCreation: () => calls++ });
  assert.equal(dropdown(h.render()).props.folders.length, 2);
  dropdown(h.render()).props.onSelect('C:\\repo');
  assert.equal(dropdown(h.render()).props.value, 'C:\\repo');
  assert.equal(calls, 0);
  const broken = await harness({ failure: new Error('Malformed preferences') });
  assert.ok(
    nodes(broken.render(), (n) => n.props.role === 'alert').some((n) =>
      String(n.props.children).includes('Malformed preferences'),
    ),
  );
  button(broken.render(), 'Enter path manually').props.onClick();
  byLabel(broken.render(), 'Project folder').props.onChange({ target: { value: 'C:\\manual' } });
  assert.equal(dropdown(broken.render()).props.value, 'C:\\manual');
});
test('required manual title is validated before queueing and accepted creation closes immediately once', async () => {
  const captured = [];
  const h = await harness({
    sourceProject: { realPath: 'C:\\repo' },
    queueProjectCreation: (value) => {
      captured.push(value);
      return 1;
    },
  });
  submit(h);
  assert.deepEqual(captured, []);
  assert.equal(h.closed(), 0);
  for (const invalid of [' ', 'a\nb', 'x'.repeat(121)]) {
    name(h, invalid);
    submit(h);
    assert.deepEqual(captured, []);
  }
  name(h, '  手动会话标题  ');
  submit(h);
  submit(h);
  assert.equal(h.closed(), 1);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].sessionTitle, '手动会话标题');
  assert.equal(captured[0].generateTitle, undefined);
  assert.equal(captured[0].branch, undefined);
});
test('worktree uses real refs and title-derived branch but preserves edited branch and directory', async () => {
  const captured = [];
  const h = await harness({
    sourceProject: { realPath: 'C:\\repo' },
    workspace: { getMode: async () => 'worktree' },
    queueProjectCreation: (options) => {
      captured.push(options);
      return 1;
    },
  });
  name(h, 'Refactor auth');
  assert.equal(byLabel(h.render(), 'Base Branch').props.value, 'refs/heads/main');
  assert.equal(byLabel(h.render(), 'New branch').props.value, 'feat/20261111_refactor-auth');
  byLabel(h.render(), 'New branch').props.onChange({ target: { value: 'feature/custom' } });
  button(h.render(), 'Edit directory…').props.onClick();
  assert.equal(
    byLabel(h.render(), 'New worktree directory').props.value,
    'C:\\repo.worktrees\\feature-custom',
  );
  byLabel(h.render(), 'New worktree directory').props.onChange({ target: { value: 'C:\\custom' } });
  name(h, 'Different title');
  dropdown(h.render()).props.onSelect('C:\\other');
  assert.equal(byLabel(h.render(), 'New branch').props.value, 'feature/custom');
  assert.equal(byLabel(h.render(), 'New worktree directory').props.value, 'C:\\custom');
  byLabel(h.render(), 'Base Branch').props.onChange({ target: { value: '__custom__' } });
  assert.equal(byLabel(h.render(), 'Custom start point').props.value, 'HEAD');
  byLabel(h.render(), 'Custom start point').props.onChange({ target: { value: 'refs/tags/v1' } });
  submit(h);
  assert.deepEqual(captured, [
    {
      agent: 'codex',
      mode: 'worktree',
      basePath: 'C:\\other',
      branch: 'feature/custom',
      targetPath: 'C:\\custom',
      startPoint: 'refs/tags/v1',
      sessionTitle: 'Different title',
    },
  ]);
});
test('all agents keep the opening local date and suffix across midnight, title and mode changes', async () => {
  for (const agent of ['claude', 'codex', 'copilot', 'gemini', 'aider']) {
    let now = new Date(2026, 10, 11, 23, 59);
    const h = await harness({
      agent,
      clock: () => now,
      sourceProject: { realPath: 'C:\\repo' },
      workspace: { getMode: async () => 'worktree' },
    });
    const initial = byLabel(h.render(), 'New branch').props.value;
    assert.match(initial, /^feat\/20261111_session-[a-f0-9]{8}$/);
    now = new Date(2026, 10, 12, 0, 1);
    name(h, 'Fix API');
    assert.equal(byLabel(h.render(), 'New branch').props.value, 'feat/20261111_fix-api');
    name(h, '中文标题');
    assert.equal(byLabel(h.render(), 'New branch').props.value, initial);
    mode(h.render(), 'folder').props.onClick();
    await flush();
    mode(h.render(), 'worktree').props.onClick();
    await flush();
    assert.equal(byLabel(h.render(), 'New branch').props.value, initial);
  }
});

test('workspace mode persists on selection and cancellation and failed saves retain current choice', async () => {
  let saved = 'worktree';
  const workspace = {
    getMode: async () => saved,
    setMode: async (value) => {
      saved = value;
    },
  };
  const h = await harness({ workspace });
  mode(h.render(), 'folder').props.onClick();
  await flush();
  assert.equal(saved, 'folder');
  button(h.render(), 'Cancel').props.onClick();
  assert.equal(h.closed(), 1);
  const reopened = await harness({ workspace, agent: 'claude' });
  assert.equal(mode(reopened.render(), 'folder').props['aria-pressed'], true);
  const broken = await harness({
    workspace: {
      setMode: async () => {
        throw new Error('disk full');
      },
    },
  });
  mode(broken.render(), 'worktree').props.onClick();
  await flush();
  assert.equal(mode(broken.render(), 'folder').props['aria-pressed'], true);
  assert.ok(nodes(broken.render(), (n) => n.props.role === 'alert').length);
});
test('pending mode saves reject duplicate changes and submission, and load failure offers retry', async () => {
  const pending = Promise.withResolvers();
  let saves = 0;
  let calls = 0;
  const h = await harness({
    sourceProject: { realPath: 'C:\\repo' },
    workspace: {
      setMode: async () => {
        saves++;
        await pending.promise;
      },
    },
    queueProjectCreation: () => calls++,
  });
  name(h);
  const change = mode(h.render(), 'worktree');
  change.props.onClick();
  change.props.onClick();
  submit(h);
  assert.equal(saves, 1);
  assert.equal(calls, 0);
  assert.equal(mode(h.render(), 'folder').props.disabled, true);
  pending.resolve();
  await flush();
  assert.equal(mode(h.render(), 'worktree').props['aria-pressed'], true);
  let reads = 0;
  const broken = await harness({
    workspace: {
      getMode: async () => {
        if (++reads === 1) throw new Error('read failure');
        return 'folder';
      },
    },
  });
  assert.equal(mode(broken.render(), 'folder').props.disabled, true);
  button(broken.render(), 'Retry workspace mode').props.onClick();
  await flush();
  assert.equal(mode(broken.render(), 'folder').props['aria-pressed'], true);
});
test('non-Git folders work in place but cannot claim worktree readiness', async () => {
  let calls = 0;
  const repository = {
    info: { exists: true, isGit: false, hasHead: false, refs: [] },
    loading: false,
  };
  const h = await harness({
    repository,
    sourceProject: { realPath: 'C:\\plain' },
    queueProjectCreation: () => {
      calls++;
      return 1;
    },
  });
  name(h);
  mode(h.render(), 'worktree').props.onClick();
  await flush();
  submit(h);
  assert.equal(calls, 0);
  mode(h.render(), 'folder').props.onClick();
  await flush();
  submit(h);
  assert.equal(calls, 1);
});
test('queue duplicates and failures keep the dialog and inputs visible', async () => {
  for (const enqueue of [
    () => null,
    () => {
      throw new Error('Queue failed');
    },
  ]) {
    const h = await harness({
      sourceProject: { realPath: 'C:\\repo' },
      queueProjectCreation: enqueue,
    });
    name(h);
    submit(h);
    assert.equal(h.closed(), 0);
    assert.ok(nodes(h.render(), (n) => n.props.role === 'alert').length);
    assert.equal(byLabel(h.render(), 'Session Title').props.value, 'My session');
  }
});
