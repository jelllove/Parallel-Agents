/* global window, document, MouseEvent */
const assert = require('node:assert/strict');
const {
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs');
const { dirname, join } = require('node:path');
const { app } = require('electron');

const [home, project, reports, mainEntry, reportName] = process.argv.slice(2);
assert.ok(
  home && project && reports && mainEntry && reportName,
  'Run this fixture through npm run test:smoke',
);
const startedAt = Date.now();
const smokeTimeoutMs = 120_000;
let finished = false;
let windowUnderTest;
let initialJavaScriptBytes;

for (const name of ['userData', 'sessionData']) {
  const path = join(home, name);
  mkdirSync(path, { recursive: true });
  app.setPath(name, path);
}
app.setPath('home', home);

function finish(error, checks = []) {
  if (finished) return;
  finished = true;
  const report = {
    success: !error,
    electron: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    packaged: reportName === 'packaged-smoke',
    initialJavaScriptBytes,
    durationMs: Date.now() - startedAt,
    checks,
    error: error ? String(error.stack ?? error) : null,
  };
  writeFileSync(join(reports, `${reportName}.json`), JSON.stringify(report, null, 2) + '\n');
  if (error) console.error(error);
  else console.log(`Electron smoke passed: ${checks.join(', ')}`);
  app.exit(error ? 1 : 0);
}

process.on('uncaughtException', (error) => finish(error));
process.on('unhandledRejection', (error) => finish(error));
setTimeout(
  () => finish(new Error(`Electron smoke test exceeded ${smokeTimeoutMs / 1000} seconds`)),
  smokeTimeoutMs,
).unref();

async function checkRenderer(projectPath) {
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    checks.push(message);
  };
  const deadline = Date.now() + 10_000;
  while (!document.querySelector('#root')?.children.length) {
    if (Date.now() > deadline) throw new Error('React did not render within 10 seconds');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  check(typeof window.api?.git?.diff === 'function', 'preload bridge is available');
  check(
    ['win32', 'darwin', 'linux'].includes(window.api.platform),
    'preload exposes a desktop platform',
  );
  check(typeof window.require === 'undefined', 'renderer has no Node require');
  const projects = await window.api.projects.list();
  const primary = projects.find((item) => item.realPath === projectPath);
  const worktree = projects.find((item) => item.worktree?.parentPath === projectPath);
  check(
    projects.length === 2 && primary && worktree,
    `provider and worktree data are isolated: ${JSON.stringify(projects.map(({ realPath, worktree }) => ({ realPath, worktree })))}`,
  );
  const projectId = primary.id;
  await Promise.all([
    window.api.projects.pin(projectId, true),
    window.api.projects.hide(projectId, true),
  ]);
  const updatedProject = (await window.api.projects.list()).find((item) => item.id === projectId);
  check(
    updatedProject?.pinned && updatedProject.hidden,
    'concurrent pin and hide IPC preserve both settings',
  );
  await Promise.all([
    window.api.projects.pin(projectId, false),
    window.api.projects.hide(projectId, false),
  ]);
  await Promise.all([
    window.api.config.setTheme('light'),
    window.api.config.setConfirmOnCloseTab(false),
    window.api.config.setTerminalMultilineEnter(false),
    window.api.config.setTerminalCopyPaste(false),
  ]);
  const settings = await Promise.all([
    window.api.config.getTheme(),
    window.api.config.getConfirmOnCloseTab(),
    window.api.config.getTerminalMultilineEnter(),
    window.api.config.getTerminalCopyPaste(),
  ]);
  check(JSON.stringify(settings) === '["light",false,false,false]', 'concurrent settings persist');
  await window.api.config.setTheme('dark');

  const diff = await window.api.git.diff(projectPath, 'notes.txt', false);
  check(
    diff.oldContent === 'staged\n' && diff.newContent === 'working\n' && diff.oldLabel === 'index',
    'Git IPC compares index to working tree',
  );
  const files = await window.api.fs.readDir(projectPath);
  check(
    files.some((file) => file.name === 'notes.txt'),
    'filesystem IPC reads the fixture',
  );
  check(!files.some((file) => file.name === '.git'), 'filesystem IPC hides Git metadata');

  let output = '';
  let resolveExit;
  const exited = new Promise((resolve) => {
    resolveExit = resolve;
  });
  const unsubscribeData = window.api.pty.onData((id, data) => {
    if (id === 'smoke-terminal') output += data;
  });
  const unsubscribeExit = window.api.pty.onExit((id, code) => {
    if (id === 'smoke-terminal') resolveExit(code);
  });
  let timer;
  try {
    await window.api.pty.spawn({
      projectId: 'smoke-terminal',
      cwd: projectPath,
      cols: 100,
      rows: 24,
      initialCommand: 'echo PARALLEL_AGENTS_SMOKE_OK && exit',
    });
    const code = await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Native PTY did not exit within 20 seconds')),
          20_000,
        );
      }),
    ]);
    // eslint-disable-next-line no-control-regex -- PTY output contains ANSI escape sequences.
    const plainOutput = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
    check(
      code === 0 &&
        plainOutput.split(/\r?\n/).some((line) => line.trim() === 'PARALLEL_AGENTS_SMOKE_OK'),
      `native PTY executes and exits successfully (code ${code}, output ${JSON.stringify(plainOutput.slice(0, 200))})`,
    );
  } finally {
    clearTimeout(timer);
    await window.api.pty.kill('smoke-terminal');
    unsubscribeData();
    unsubscribeExit();
  }

  const uiPtys = new Set();
  let uiOutput = '';
  const unsubscribeUi = window.api.pty.onData((id, data) => {
    uiPtys.add(id);
    uiOutput += data;
  });
  const waitFor = async (predicate, message, timeoutMs = 12_000) => {
    const until = Date.now() + timeoutMs;
    while (!(await predicate())) {
      if (Date.now() > until) throw new Error(typeof message === 'function' ? message() : message);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  try {
    let refresh;
    await waitFor(() => {
      refresh = [...document.querySelectorAll('button')].find((button) =>
        /refresh projects/i.test(
          `${button.getAttribute('aria-label') ?? ''} ${button.getAttribute('title') ?? ''} ${button.textContent ?? ''}`,
        ),
      );
      return refresh && !refresh.disabled;
    }, 'The inventory refresh action is unavailable');
    refresh.click();
    await waitFor(
      () =>
        document.querySelector('.project-item') &&
        document.querySelector('.agent-group-header[title="Claude Code"]:not(.unavailable)'),
      'The isolated project and CLI did not appear',
    );
    check(!document.querySelector('.section-sessions'), 'there is no separate sessions panel');
    check(
      document.querySelectorAll('.project-item').length === 1,
      'worktree is grouped under its project',
    );
    document.querySelector('.project-caret').click();
    await waitFor(
      () => document.querySelectorAll('.project-sessions .session-open').length === 2,
      'Both main and worktree sessions did not appear inline',
    );
    check(
      document.querySelector('.session-branch')?.textContent === 'feature/sidebar',
      'worktree session displays its branch',
    );
    check(
      [...document.querySelectorAll('.agent-group-icon')].every((icon) => {
        const rect = icon.getBoundingClientRect();
        return rect.width === 14 && rect.height === 14;
      }),
      'all sidebar Agent icons including Codex use the same 14px box',
    );
    check(
      document.querySelector('.project-item').getBoundingClientRect().height === 30 &&
        parseFloat(
          window.getComputedStyle(document.querySelector('.project-sessions')).marginBottom,
        ) === 4,
      'project rows and spacing between project groups are compact',
    );
    check(
      [...document.querySelectorAll('.project-sessions .session-item')].every(
        (row) => row.getBoundingClientRect().height <= 52,
      ),
      'two-line session rows retain compact spacing',
    );
    const baseSession = [...document.querySelectorAll('.session-open')].find((button) =>
      button.textContent.includes('Isolated smoke fixture'),
    );
    baseSession.click();
    await waitFor(() => uiOutput.includes('SMOKE_AGENT'), 'The initial inert CLI command was lost');
    checks.push('the initial CLI command reaches the mounted terminal');
    await waitFor(
      () => document.querySelectorAll('.git-row[title="notes.txt"]').length === 2,
      'Git panel did not show the fixture changes',
    );
    const rows = document.querySelectorAll('.git-row[title="notes.txt"]');
    rows[rows.length - 1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    let text = '';
    await waitFor(
      () => {
        text = document.querySelector('.monaco-diff-editor')?.textContent ?? '';
        return text.includes('staged') || text.includes('working');
      },
      () => `Offline diff revisions did not render; observed ${JSON.stringify(text.slice(0, 200))}`,
      25_000,
    );
    check(
      text.includes('staged') || text.includes('working'),
      'offline diff opens with a fixture revision rendered',
    );
    document.querySelector('.diff-close').click();
    const worktreeSession = [...document.querySelectorAll('.session-open')].find((button) =>
      button.textContent.includes('Isolated worktree session'),
    );
    worktreeSession.click();
    await waitFor(
      () => [...uiPtys].some((id) => id.includes('worktree-session')),
      'Worktree session did not start its own terminal',
    );
    const worktreePty = [...uiPtys].find(
      (id) => id.includes('worktree-session') && id.endsWith('::agent'),
    );
    check(
      Boolean(worktreePty),
      'worktree session retains its original project and session identity',
    );
    uiOutput = '';
    await window.api.pty.write(worktreePty, window.api.platform === 'win32' ? 'cd\r' : 'pwd\r');
    await waitFor(
      () => uiOutput.replaceAll('\\', '/').includes(worktree.realPath.replaceAll('\\', '/')),
      'Resumed worktree terminal did not use the worktree directory',
    );
    checks.push('inline worktree session resumes in its own working directory');
    check(
      !document.querySelector('.project-text .list-item-sub') &&
        document.querySelector('.project-caret svg'),
      'project row uses a line folder icon and a single-line name',
    );
    const activeSession = document.querySelector('.project-sessions .session-item.active');
    const originalTheme = document.documentElement.dataset.theme;
    try {
      for (const [theme, background] of [
        ['dark', 'rgb(55, 55, 61)'],
        ['light', 'rgb(227, 227, 232)'],
      ]) {
        document.documentElement.dataset.theme = theme;
        await waitFor(
          () => window.getComputedStyle(activeSession).backgroundColor === background,
          `${theme} neutral selection did not settle`,
        );
        const style = window.getComputedStyle(activeSession);
        check(
          style.backgroundColor === background && style.borderLeftWidth === '0px',
          `${theme} sidebar uses neutral selection without a blue border`,
        );
        check(
          window.getComputedStyle(document.querySelector('.project-sessions')).borderLeftWidth ===
            '0px',
          `${theme} sidebar has no vertical tree rule`,
        );
        const headerStyle = window.getComputedStyle(document.querySelector('.agent-group-header'));
        check(
          headerStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
            headerStyle.backgroundColor !==
              window.getComputedStyle(document.querySelector('.project-tree')).backgroundColor &&
            parseFloat(headerStyle.borderRadius) >= 4,
          `${theme} Agent header is a distinct background block`,
        );
      }
    } finally {
      document.documentElement.dataset.theme = originalTheme;
    }
    const sidebar = document.querySelector('.sidebar');
    const projectTitle = document.querySelector('.project-open .list-item-title');
    const sessionTitle = activeSession.querySelector('.list-item-title');
    const originalWidth = sidebar.style.width;
    const originalProjectTitle = projectTitle.textContent;
    const originalSessionTitle = sessionTitle.textContent;
    const longTitle =
      'A long project and session title that needs responsive truncation without overlapping actions';
    try {
      projectTitle.textContent = longTitle;
      sessionTitle.textContent = longTitle;
      let narrowTitleWidth;
      for (const width of [240, 480]) {
        sidebar.style.width = `${width}px`;
        const titleRect = sessionTitle.getBoundingClientRect();
        const rename = activeSession.querySelector('.session-rename');
        const remove = activeSession.querySelector('.session-delete');
        const renameRect = rename.getBoundingClientRect();
        check(
          titleRect.right <= renameRect.left &&
            renameRect.right <= remove.getBoundingClientRect().left &&
            remove.getBoundingClientRect().right <= sidebar.getBoundingClientRect().right,
          `session title and action buttons do not overlap at ${width}px`,
        );
        check(
          window.getComputedStyle(sessionTitle).textOverflow === 'ellipsis' &&
            window.getComputedStyle(projectTitle).textOverflow === 'ellipsis' &&
            projectTitle.scrollWidth > projectTitle.clientWidth,
          `long project and session names use ellipsis at ${width}px`,
        );
        rename.focus();
        check(
          window.getComputedStyle(rename).opacity === '1',
          'rename action remains visible on keyboard focus',
        );
        rename.blur();
        if (width === 240) narrowTitleWidth = titleRect.width;
        else
          check(
            titleRect.width > narrowTitleWidth + 150,
            'widening the sidebar gives titles more space',
          );
      }
    } finally {
      sidebar.style.width = originalWidth;
      projectTitle.textContent = originalProjectTitle;
      sessionTitle.textContent = originalSessionTitle;
    }
    document.querySelector('.project-caret').click();
    await waitFor(
      async () => (await window.api.config.getSidebarTree()).expandedProjects.length === 0,
      'Project collapse was not saved',
    );
    refresh.click();
    await waitFor(() => refresh.disabled, 'Inventory refresh did not start');
    await waitFor(() => !refresh.disabled, 'Inventory refresh did not finish');
    check(
      document.querySelector('.project-caret').getAttribute('aria-expanded') === 'false',
      'inventory refresh preserves a manually collapsed selected project',
    );
    document.querySelector('.project-caret').click();
    document.querySelector('.agent-group-header[title="GitHub Copilot"]').click();
    document.querySelector('.agent-group-header[title="Gemini CLI"]').click();
    await waitFor(async () => {
      const tree = await window.api.config.getSidebarTree();
      return (
        tree.expandedProjects.length === 1 &&
        tree.collapsedAgents.includes('copilot') &&
        tree.collapsedAgents.includes('gemini')
      );
    }, 'Expanded project and collapsed Agent sections were not saved');
    checks.push('tree expansion changes persist through the real config bridge');
    const header = (agent) => document.querySelector(`.agent-group-header[data-agent="${agent}"]`);
    const order = () =>
      [...document.querySelectorAll('.agent-group-header')]
        .map((item) => item.dataset.agent)
        .join(',');
    const initialOrder = 'copilot,codex,claude,gemini,aider';
    check(order() === initialOrder, 'Agent headers expose their default ordering');
    const drag = (source, target, after = false, cancel = false) => {
      const dataTransfer = new window.DataTransfer();
      const bounds = target.getBoundingClientRect();
      const options = {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientY: after ? bounds.bottom - 2 : bounds.top + 2,
      };
      source.dispatchEvent(new window.DragEvent('dragstart', options));
      target.dispatchEvent(new window.DragEvent('dragover', options));
      if (!cancel) target.dispatchEvent(new window.DragEvent('drop', options));
      source.dispatchEvent(new window.DragEvent('dragend', options));
    };
    check(header('copilot')?.draggable, 'Agent header blocks are draggable');
    drag(header('copilot'), header('aider'), true, true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    check(order() === initialOrder, 'cancelling an Agent drag leaves the order unchanged');
    drag(document.querySelector('.project-item'), header('aider'), true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    check(order() === initialOrder, 'project drags cannot reorder Agent sections');
    drag(header('copilot'), header('aider'), true);
    await waitFor(
      () => order() === 'codex,claude,gemini,aider,copilot',
      'Downward Agent drag failed',
    );
    drag(header('gemini'), header('codex'));
    await waitFor(
      () => order() === 'gemini,codex,claude,aider,copilot',
      'Upward Agent drag failed',
    );
    header('gemini').focus();
    header('gemini').dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'ArrowDown',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitFor(
      () => order() === 'codex,gemini,claude,aider,copilot',
      'Keyboard Agent reorder failed',
    );
    header('gemini').dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'ArrowUp',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitFor(() => order() === 'gemini,codex,claude,aider,copilot', 'Keyboard move-up failed');
    await waitFor(
      async () => (await window.api.config.getSidebarTree()).agentOrder.join(',') === order(),
      'Final Agent order was not persisted',
    );
    check(
      header('gemini').getAttribute('aria-expanded') === 'false' &&
        header('copilot').getAttribute('aria-expanded') === 'false' &&
        document.querySelector('.project-caret').getAttribute('aria-expanded') === 'true',
      'Agent reordering preserves Agent and project disclosure state',
    );
    refresh.click();
    await waitFor(() => refresh.disabled, 'Reorder refresh did not start');
    await waitFor(() => !refresh.disabled, 'Reorder refresh did not finish');
    check(
      order() === 'gemini,codex,claude,aider,copilot',
      'Agent order survives inventory refresh',
    );
    checks.push(
      'Agent sections support up/down drag and keyboard reorder with durable final order',
    );
  } finally {
    unsubscribeUi();
    await Promise.all([...uiPtys].map((id) => window.api.pty.kill(id)));
  }
  return checks;
}

async function checkRestoredSidebar(expanded) {
  const waitFor = async (predicate, message) => {
    const deadline = Date.now() + 12_000;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error(message);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  await waitFor(
    () =>
      document.querySelector('.project-caret')?.getAttribute('aria-expanded') ===
        String(expanded) &&
      document
        .querySelector('.agent-group-header[title="GitHub Copilot"]')
        ?.getAttribute('aria-expanded') === 'false' &&
      document
        .querySelector('.agent-group-header[title="Gemini CLI"]')
        ?.getAttribute('aria-expanded') === 'false',
    'Saved Agent/project expansion was not restored after reload',
  );
  const restoredOrder = [...document.querySelectorAll('.agent-group-header')].map(
    (item) => item.dataset.agent,
  );
  if (restoredOrder.join(',') !== 'gemini,codex,claude,aider,copilot') {
    throw new Error(`Saved Agent order was not restored: ${restoredOrder.join(',')}`);
  }
  if (document.querySelector('.tab-bar .tab')) {
    throw new Error('Restoring the sidebar must not launch a terminal');
  }
  if (expanded) {
    await waitFor(
      () => document.querySelectorAll('.project-sessions .session-open').length === 2,
      'Restored project did not load its inline sessions',
    );
  }
  document.querySelector('.project-caret').click();
  await waitFor(
    async () =>
      (await window.api.config.getSidebarTree()).expandedProjects.length === (expanded ? 0 : 1),
    'Toggling a restored project did not persist',
  );
  if (!expanded) {
    await waitFor(
      () => document.querySelectorAll('.project-sessions .session-open').length === 2,
      'Reopened project did not load its inline sessions',
    );
  }
  return `renderer reload restores Agent order, ${expanded ? 'expanded' : 'collapsed'} projects and collapsed Agent sections without launching terminals`;
}

app.on('browser-window-created', (_event, win) => {
  if (windowUnderTest) return;
  windowUnderTest = win;
  const preferences = win.webContents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true, 'The preload must run in the Electron sandbox');
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  win.webContents.session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (_request, callback) => callback({ cancel: true }),
  );
  win.webContents.once('did-fail-load', (_loadEvent, code, description) => {
    finish(new Error(`Renderer load failed (${code}): ${description}`));
  });
  win.webContents.once('render-process-gone', (_goneEvent, details) => {
    finish(new Error(`Renderer terminated: ${details.reason}`));
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      const agents = await win.webContents.executeJavaScript('window.api.agents.checkAll()');
      const normalize = (path) => {
        const resolved = realpathSync.native(path);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
      };
      for (const agent of ['claude', 'copilot', 'codex', 'gemini', 'aider']) {
        const expected = join(home, 'bin', `${agent}${process.platform === 'win32' ? '.cmd' : ''}`);
        assert.ok(agents[agent]?.path, `${agent} fixture shim must be available`);
        assert.equal(
          normalize(agents[agent].path),
          normalize(expected),
          `${agent} must resolve only to its inert fixture shim`,
        );
      }
      const checks = await win.webContents.executeJavaScript(
        `(${checkRenderer.toString()})(${JSON.stringify(project)})`,
      );
      checks.push('all provider executables resolve to inert fixture shims');
      assert.equal(
        await win.webContents.executeJavaScript('window.api.platform'),
        process.platform,
        'preload platform matches the actual runtime',
      );
      const copilotRoot = join(home, '.copilot', 'session-state');
      mkdirSync(dirname(copilotRoot), { recursive: true });
      writeFileSync(copilotRoot, 'not a directory');
      const deleteCopilotProject = `window.api.projects.delete(${JSON.stringify(`copilot:${project}`)})`;
      console.log('Checking expected ENOTDIR rejection for isolated provider storage');
      await assert.rejects(
        win.webContents.executeJavaScript(deleteCopilotProject),
        /ENOTDIR|not a directory/i,
      );
      unlinkSync(copilotRoot);
      mkdirSync(copilotRoot);
      const controlFile = join(copilotRoot, 'metadata.json');
      writeFileSync(controlFile, '{}');
      await win.webContents.executeJavaScript(deleteCopilotProject);
      assert.equal(readFileSync(controlFile, 'utf8'), '{}');
      checks.push('project deletion surfaces storage errors and preserves non-session files');
      for (const expanded of [true, false]) {
        const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
        win.webContents.reload();
        await loaded;
        checks.push(
          await win.webContents.executeJavaScript(
            `(${checkRestoredSidebar.toString()})(${expanded})`,
          ),
        );
      }
      checks.unshift('initial entry and preload JavaScript stay below 800 KB');
      checks.unshift('sandboxed preload and context isolation are enabled');
      assert.doesNotThrow(() => app.emit('window-all-closed'));
      checks.push('tray lifecycle event is safe');
      const image = await win.capturePage();
      writeFileSync(join(reports, `${reportName}.png`), image.toPNG());
      finish(null, checks);
    } catch (error) {
      finish(error);
    }
  });
});

const rendererRoot = join(dirname(mainEntry), '..', 'renderer');
const rendererHtml = readFileSync(join(rendererRoot, 'index.html'), 'utf8');
const initialAssets = [
  ...new Set(
    [...rendererHtml.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+\.js)"/g)].map(
      (match) => match[1],
    ),
  ),
];
assert.ok(initialAssets.length > 0, 'Expected initial renderer JavaScript assets');
initialJavaScriptBytes = initialAssets.reduce(
  (total, asset) => total + statSync(join(rendererRoot, asset)).size,
  0,
);
assert.ok(
  initialJavaScriptBytes < 800_000,
  `Initial entry and preload JavaScript exceed 800 KB: ${initialJavaScriptBytes}`,
);

require(mainEntry);
