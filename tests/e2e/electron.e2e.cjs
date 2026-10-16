/* global window, document, MouseEvent, DragEvent, DataTransfer */
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
const { app, shell, Menu } = require('electron');

const externalLinks = [];
shell.openExternal = async (url) => {
  externalLinks.push(url);
};

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
  check(projects.length === 1 && projects[0].realPath === projectPath, 'provider data is isolated');
  const projectId = projects[0].id;
  await window.api.agents.setLaunchOptions(
    'claude',
    { approvalMode: 'plan', model: 'sonnet' },
    false,
  );
  await window.api.agents.setLaunchOptions(
    'copilot',
    { approvalMode: 'default', model: 'smoke-copilot-model' },
    false,
  );
  const launchSettings = await window.api.agents.getLaunchSettings();
  check(
    launchSettings.claude.model === 'sonnet' &&
      launchSettings.copilot.model === 'smoke-copilot-model',
    'launch settings persist models independently for each provider',
  );
  let rejectedUnsafeSave = false;
  try {
    await window.api.agents.setLaunchOptions(
      'copilot',
      { approvalMode: 'auto-tools', model: '' },
      false,
    );
  } catch (error) {
    rejectedUnsafeSave = /acknowledge/i.test(String(error));
  }
  check(rejectedUnsafeSave, 'main rejects unacknowledged reduced-approval settings');
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
    while (!predicate()) {
      if (Date.now() > until) throw new Error(typeof message === 'function' ? message() : message);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  try {
    const aboutButton = document.querySelector('.sidebar-about');
    check(aboutButton?.textContent.trim() === 'iAbout', 'original simple About entry is preserved');
    check(
      !aboutButton.querySelector('.about-update-badge'),
      'About entry has no update status badge',
    );
    aboutButton.click();
    await waitFor(
      () => document.querySelector('[role="dialog"][aria-labelledby="about-title"]'),
      'About dialog did not open',
    );
    const about = document.querySelector('.about-dialog');
    await waitFor(
      () => !about.textContent.includes('Loading update status'),
      'About update status did not load',
    );
    check(
      about.textContent.includes('Installed version:') &&
        about.querySelector('[aria-label="Application updates"]'),
      'About displays installed version and application update controls',
    );
    for (const url of [
      'http://www.jelllove.com',
      'https://github.com/jelllove/Parallel-Agents/releases/latest',
    ]) {
      const link = about.querySelector(`a[href="${url}"]`);
      check(Boolean(link), `About provides external link: ${url}`);
      link.click();
    }
    check(!about.querySelector('[role="alert"]'), 'About external links do not produce UI errors');
    about.querySelector('button[aria-label="Close About"]').click();
    await waitFor(() => !document.querySelector('.about-dialog'), 'About did not close');
    await waitFor(
      () =>
        document.querySelector(
          '[data-agent-id="codex"] button[aria-label="New project with Codex CLI"]',
        ),
      'Agent header does not expose a quick New Project button',
    );
    const quickCreate = document.querySelector(
      '[data-agent-id="codex"] button[aria-label="New project with Codex CLI"]',
    );
    await waitFor(() => !quickCreate.disabled, 'Codex quick-create remains disabled');
    quickCreate.click();
    await waitFor(
      () => document.querySelector('.workflow-dialog h2')?.textContent.includes('Codex'),
      'Agent quick-create did not open the Codex project dialog',
    );
    const workspaceSelect = () =>
      document.querySelector('.workflow-dialog select[aria-label="Workspace mode"]');
    await waitFor(
      () => workspaceSelect() && !workspaceSelect().disabled,
      'Workspace mode did not load',
    );
    check(
      document.querySelector('.workflow-launch-settings svg') !== null,
      'launch configuration button displays a settings icon',
    );
    check(
      !document.querySelector('.recent-folders-section input[type="search"]'),
      'recent folders no longer show a search box',
    );
    check(
      workspaceSelect().querySelector('option[value="folder"]').textContent.startsWith('📂 ') &&
        workspaceSelect().querySelector('option[value="worktree"]').textContent.startsWith('🌿 '),
      'native workspace options display distinct folder and branch icons',
    );
    workspaceSelect().value = 'worktree';
    workspaceSelect().dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(
      () => workspaceSelect().value === 'worktree' && !workspaceSelect().disabled,
      'Workspace mode did not finish saving',
    );
    [...document.querySelectorAll('.workflow-dialog button')]
      .find((button) => button.textContent === 'Cancel')
      .click();
    document.querySelector('[data-agent-id="claude"] .agent-quick-create').click();
    await waitFor(
      () =>
        document.querySelector('.workflow-dialog h2')?.textContent.includes('Claude') &&
        workspaceSelect()?.value === 'worktree' &&
        !workspaceSelect().disabled,
      'Cancelled workspace mode was not restored for a different agent',
    );
    check(
      (await window.api.workspace.getMode()) === 'worktree',
      'workspace mode is saved before creation and shared across agent dialogs',
    );
    workspaceSelect().value = 'folder';
    workspaceSelect().dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(
      () => workspaceSelect().value === 'folder' && !workspaceSelect().disabled,
      'Workspace mode could not switch back to opening a folder',
    );
    [...document.querySelectorAll('.workflow-dialog button')]
      .find((button) => button.textContent === 'Cancel')
      .click();
    checks.push('agent-specific quick-create opens the existing dialog with the correct provider');
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
    document.querySelector('.project-item').click();
    await waitFor(() => uiOutput.includes('SMOKE_AGENT'), 'The initial inert CLI command was lost');
    await waitFor(
      () =>
        uiOutput.includes(
          'SMOKE_AGENT_ARGS --resume smoke-session --permission-mode plan --model sonnet',
        ),
      'The selected provider mode/model did not reach the actual inert CLI argv',
    );
    checks.push(
      'existing project session receives exact provider-specific mode and model arguments',
    );
    checks.push('the initial CLI command reaches the mounted terminal');
    const originalTerminal = document.querySelector('.xterm');
    const originalTabCount = document.querySelectorAll('.terminal-tab').length;
    const originalPtys = [...uiPtys].sort().join(',');
    const header = (id) => document.querySelector(`[data-agent-id="${id}"] .agent-group-header`);
    const groupOrder = () =>
      [...document.querySelectorAll('[data-agent-id]')].map((group) => group.dataset.agentId);
    const settleSidebar = async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      await waitFor(
        () => !header('claude').querySelector('.sidebar-pin').disabled,
        'Sidebar order did not finish saving',
      );
    };
    const dragSidebar = async (from, to) => {
      const dataTransfer = new DataTransfer();
      from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      to.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }),
      );
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
      from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
      await settleSidebar();
    };
    await settleSidebar();
    await dragSidebar(header('gemini'), header('copilot'));
    await waitFor(() => groupOrder()[0] === 'gemini', 'Dragging agent groups did not reorder them');
    header('claude').querySelector('.sidebar-pin').click();
    await waitFor(
      () => groupOrder()[0] === 'claude',
      'Agent Pin did not move the group to the top',
    );
    await settleSidebar();
    header('copilot').querySelector('.sidebar-pin').click();
    await settleSidebar();
    await dragSidebar(header('claude'), header('copilot'));
    await waitFor(
      () => groupOrder()[0] === 'claude',
      'Pinned agent groups cannot be manually reordered',
    );
    const pinnedOrder = groupOrder().join(',');
    await dragSidebar(header('gemini'), header('claude'));
    check(
      groupOrder().join(',') === pinnedOrder,
      'agent dragging cannot cross the pinned boundary',
    );
    const savedAgentLayout = await window.api.config.getAgentLayout();
    check(
      savedAgentLayout.agentOrder[0] === 'claude' &&
        savedAgentLayout.pinnedAgents.includes('claude') &&
        savedAgentLayout.pinnedAgents.includes('copilot'),
      'agent pins and manual ordering cross IPC and persist',
    );
    const separator = projectPath.includes('\\') ? '\\' : '/';
    for (const name of ['sidebar-order-one', 'sidebar-order-two']) {
      const path = `${projectPath}${separator}${name}`;
      await window.api.fs.createDir(path);
      await window.api.projects.create({ agent: 'claude', mode: 'folder', basePath: path });
    }
    document.querySelector('button[aria-label="Refresh projects and agents"]').click();
    const projectRow = (name) =>
      [...document.querySelectorAll('[data-agent-id="claude"] .project-item')].find(
        (item) => item.querySelector('.list-item-title').textContent === name,
      );
    await waitFor(() => projectRow('sidebar-order-two'), 'New fixture projects did not appear');
    check(
      projectRow('sidebar-order-two').querySelector(':scope > .sidebar-pin') !== null,
      'project pin stays beside the compact name/path column',
    );
    for (const name of ['sidebar-order-one', 'sidebar-order-two']) {
      projectRow(name).querySelector('.sidebar-pin').click();
      await waitFor(
        () =>
          projectRow(name).querySelector('.sidebar-pin').getAttribute('aria-pressed') === 'true',
        'Project Pin did not save',
      );
      await settleSidebar();
    }
    const projectNames = () =>
      [...document.querySelectorAll('[data-agent-id="claude"] .project-item .list-item-title')].map(
        (item) => item.textContent,
      );
    await dragSidebar(projectRow('sidebar-order-two'), projectRow('sidebar-order-one'));
    await waitFor(
      () => projectNames()[0] === 'sidebar-order-two',
      'Pinned projects did not reorder',
    );
    const persistedProjects = (await window.api.projects.list()).filter(
      (item) => item.agent === 'claude',
    );
    check(
      persistedProjects[0].displayName === 'sidebar-order-two' &&
        persistedProjects[0].pinned &&
        persistedProjects[1].pinned,
      'project pins and manual ordering persist within their agent',
    );
    check(
      document.querySelector('.xterm') === originalTerminal &&
        document.querySelectorAll('.terminal-tab').length === originalTabCount &&
        [...uiPtys].sort().join(',') === originalPtys,
      'sidebar quick actions and ordering do not open projects or recreate running terminals',
    );
    const beforeLayout = await window.api.config.getLayout();
    const togglePane = async (label, isHidden) => {
      const control = document.querySelector(`button[aria-label="${label}"]`);
      await waitFor(() => !control.disabled, `${label} control is unavailable`);
      control.click();
      await waitFor(isHidden, `${label} did not update pane visibility`);
      await waitFor(() => !control.disabled, `${label} did not persist pane visibility`);
    };
    const projectPane = () => document.querySelector('.workspace-pane[data-pane="sidebar"]');
    const filesPane = () => document.querySelector('.workspace-pane[data-pane="right"]');
    const codingPane = () => document.querySelector('.workspace-pane[data-pane="middle"]');
    await togglePane('Toggle project sidebar', () => projectPane().hidden);
    check(
      !filesPane().hidden && codingPane().getBoundingClientRect().width > 200,
      'project sidebar hides independently while coding remains visible',
    );
    await togglePane('Toggle project sidebar', () => !projectPane().hidden);
    await togglePane('Toggle files and Git sidebar', () => filesPane().hidden);
    check(!projectPane().hidden, 'files and Git sidebar hides independently');
    await togglePane('Toggle files and Git sidebar', () => !filesPane().hidden);
    await togglePane('Focus coding', () => filesPane().hidden && projectPane().hidden);
    await waitFor(
      () =>
        codingPane().getBoundingClientRect().width >=
        document.querySelector('.app-body').getBoundingClientRect().width - 8,
      'focused terminal did not fill the coding workspace',
    );
    check(
      document.querySelector('.xterm') === originalTerminal,
      'focus coding preserves the mounted terminal rather than recreating it',
    );
    check(
      document.querySelector('button[aria-label="Focus coding"]') !== null,
      'restore controls remain accessible with both sidebars hidden',
    );
    const focusedLayout = await window.api.config.getLayout();
    check(
      focusedLayout.hiddenPanes.includes('sidebar') && focusedLayout.hiddenPanes.includes('right'),
      'focus mode persists sidebar visibility',
    );
    await togglePane('Focus coding', () => !filesPane().hidden && !projectPane().hidden);
    const afterLayout = await window.api.config.getLayout();
    check(
      afterLayout.sizes.every((size, index) => Math.abs(size - beforeLayout.sizes[index]) < 0.1),
      'restoring sidebars retains the original expanded widths',
    );
    check(
      document.querySelector('.xterm') === originalTerminal &&
        document.querySelectorAll('.terminal-tab').length === originalTabCount &&
        [...uiPtys].sort().join(',') === originalPtys,
      'sidebar toggles keep session tabs and PTY identities unchanged',
    );
    check(
      (await window.api.workspace.getRecentFolders()).includes(projectPath),
      'opening an existing project persists its folder history',
    );
    const openNewDialog = async () => {
      const newProject = [...document.querySelectorAll('button')].find((button) =>
        button.textContent.includes('New Project'),
      );
      newProject.click();
      await waitFor(
        () => document.querySelector('.agent-picker-row[title="Claude Code"]'),
        'New Project agent picker unavailable',
      );
      document.querySelector('.agent-picker-row[title="Claude Code"]').click();
      await waitFor(
        () => document.querySelector('dialog[open] .recent-folder'),
        'Recent folder list did not appear',
      );
    };
    await openNewDialog();
    [...document.querySelectorAll('dialog[open] button')]
      .find((button) => button.textContent.includes('Configure Claude Code'))
      .click();
    await waitFor(
      () =>
        document.querySelector('.agent-launch-dialog[open] input[aria-label="Model ID"]')?.value ===
        'sonnet',
      'Agent launch options did not load in the actual dialog',
    );
    const launchDialog = document.querySelector('.agent-launch-dialog[open]');
    check(
      launchDialog.querySelector('select[aria-label="Approval mode"]').value === 'plan',
      'launch dialog shows Claude mode and model without mixing Copilot settings',
    );
    [...launchDialog.querySelectorAll('button')]
      .find((button) => button.textContent === 'Cancel')
      .click();
    await waitFor(
      () => !document.querySelector('.agent-launch-dialog[open]'),
      'Launch options dialog did not close',
    );
    const recent = [...document.querySelectorAll('.recent-folder')].find(
      (button) => button.title === projectPath,
    );
    check(Boolean(recent), 'Create/Open dialog displays the previously opened folder');
    await waitFor(
      () =>
        [...document.querySelectorAll('.recent-folder img')].every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      'Recent folder icons did not load from local assets',
    );
    check(
      document.querySelectorAll('.recent-folder img').length ===
        document.querySelectorAll('.recent-folder').length,
      'every recent folder has a local folder icon',
    );
    recent.click();
    await waitFor(
      () => document.querySelector('dialog[open] .workflow-path input').value === projectPath,
      'recent folder selection did not update the project path',
    );
    check(
      document.querySelector('dialog[open] .workflow-path input').value === projectPath,
      'recent folder selection fills the existing project path',
    );
    const cancelNew = () =>
      [...document.querySelectorAll('dialog[open] button')]
        .find((button) => button.textContent === 'Cancel')
        .click();
    cancelNew();
    let resumed = '';
    const offResume = window.api.pty.onData((id, data) => {
      if (id === 'smoke-resume-options') resumed += data;
    });
    try {
      await window.api.pty.spawn({
        projectId: 'smoke-resume-options',
        cwd: projectPath,
        cols: 100,
        rows: 24,
        initialCommand: 'claude --resume smoke-session',
      });
      await waitFor(
        () =>
          resumed.includes(
            'SMOKE_AGENT_ARGS --resume smoke-session --permission-mode plan --model sonnet',
          ),
        'Resume command lost its session ID or provider launch settings',
      );
      checks.push('resumed agent receives the same mode/model while preserving its session ID');
    } finally {
      offResume();
      await window.api.pty.kill('smoke-resume-options');
    }
    let started = '';
    const offStart = window.api.pty.onData((id, data) => {
      if (id === 'smoke-start-options') started += data;
    });
    try {
      await window.api.pty.spawn({
        projectId: 'smoke-start-options',
        cwd: projectPath,
        cols: 100,
        rows: 24,
        initialCommand: 'claude',
      });
      await waitFor(
        () => started.includes('SMOKE_AGENT_ARGS --permission-mode plan --model sonnet'),
        'New agent command did not receive its configured mode/model',
      );
      checks.push('new agent launches receive exact provider-specific mode and model arguments');
    } finally {
      offStart();
      await window.api.pty.kill('smoke-start-options');
    }
    await openNewDialog();
    check(
      [...document.querySelectorAll('.recent-folder')].some(
        (button) => button.title === projectPath,
      ),
      'folder history survives closing and reopening the Create/Open dialog',
    );
    cancelNew();
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
  } finally {
    unsubscribeUi();
    await Promise.all([...uiPtys].map((id) => window.api.pty.kill(id)));
  }
  return checks;
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
      if (process.platform === 'win32') {
        assert.equal(Menu.getApplicationMenu(), null, 'Windows must not retain the default menu');
        assert.equal(win.isMenuBarVisible(), false);
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Alt' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Alt' });
        await win.webContents.executeJavaScript('Promise.resolve()');
        assert.equal(win.isMenuBarVisible(), false, 'Alt must not reveal a Windows menu bar');
        checks.push('Windows has no application menu and Alt does not reveal a menu bar');
      }
      assert.deepEqual(externalLinks, [
        'http://www.jelllove.com',
        'https://github.com/jelllove/Parallel-Agents/releases/latest',
      ]);
      checks.push('About website and release links cross IPC without opening a real browser');
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
