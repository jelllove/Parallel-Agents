import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import { listProjects, deleteProject, deleteMissingProjects, createProject } from './projects.ts';
import { listSessionsForProject, deleteSession, renameSession } from './sessions.ts';
import {
  readDir,
  createFile,
  createDir,
  renamePath,
  copyPath,
  movePath,
  trashPath,
  revealInExplorer,
  openWithDefault,
} from './fs-explorer.ts';
import {
  setProjectPinned,
  getAgentLayout,
  setAgentOrder,
  setAgentPinned,
  setProjectHidden,
  setLastAgent,
  getLastAgent,
  setProjectOrder,
  getLayout,
  setLayout,
  getSidebarTree,
  setSidebarTree,
  getTheme,
  setTheme,
  getConfirmOnCloseTab,
  setConfirmOnCloseTab,
  getTerminalMultilineEnter,
  setTerminalMultilineEnter,
  getTerminalCopyPaste,
  setTerminalCopyPaste,
} from './config.ts';
import { ptyManager } from './pty-manager.ts';
import { checkAllAgents, listAgents } from './agent-providers.ts';
import * as git from './git.ts';
import type {
  AgentId,
  LayoutConfig,
  ThemeMode,
  NewProjectOptions,
  PtySpawnOptions,
  SidebarTreeState,
  WorkspaceMode,
} from '../shared/types.ts';
import { preferences } from './preferences-store.ts';
import { prepareAgentLaunch } from './agent-launcher.ts';
import { AGENT_LAUNCH, commandAgent } from '../shared/agent-launch.ts';
import { activityRuntime, ensureActivityReporter } from './activity-service.ts';
import { managedSessions } from './managed-session-runtime.ts';
import {
  inspectSessionOrder,
  moveSessionRow,
  promoteSessionDraft,
} from './session-arrangement-service.ts';
import { removeSessionOrder } from './config.ts';
import type { AgentLaunchOptions } from '../shared/agent-launch.ts';
import { discoverShells } from './shell-profiles.ts';
import type { UpdateController } from './update-controller.ts';
import { titleBarOverlayFor } from './window-titlebar.ts';
import { readRecentFolders, recordRecentFolder } from './workspace-history.ts';
import { sessionDeletion } from './session-deletion-runtime.ts';
import { guardCheckout } from './checkout-guard.ts';
import type { DeleteTarget } from '../shared/session-deletion.ts';
import { validateSessionName } from '../shared/session-presentation.ts';
import { inspectWorkspaceRepository } from './workspace-repository.ts';

export function registerIpc(win: BrowserWindow, updates: UpdateController) {
  ptyManager.attachWindow(win);
  git.attachWindow(win);

  ipcMain.handle('updates:getStatus', () => updates.getStatus());
  ipcMain.handle('updates:check', () => updates.check());
  ipcMain.handle('updates:install', () => updates.install());
  const unsubscribeUpdates = updates.subscribe((status) => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('updates:status', status);
    }
  });
  win.once('closed', () => {
    unsubscribeUpdates();
    for (const channel of ['updates:getStatus', 'updates:check', 'updates:install'])
      ipcMain.removeHandler(channel);
  });

  ipcMain.handle('projects:list', () => listProjects());
  ipcMain.handle('config:getSidebarTree', () => getSidebarTree());
  ipcMain.handle('config:setSidebarTree', (_e, tree: SidebarTreeState) => setSidebarTree(tree));
  ipcMain.handle('projects:create', (_e, options: NewProjectOptions) =>
    guardCheckout(options.basePath, () => createProject(options)),
  );
  ipcMain.handle('sessions:previewDeletion', (_event, targets: DeleteTarget[]) =>
    sessionDeletion.preview(targets),
  );
  ipcMain.handle('sessions:deleteReviewed', (_event, token: string, keys: string[]) =>
    sessionDeletion.deleteReviewed(token, keys),
  );
  ipcMain.handle('sessions:finishDeletion', (_event, token: string) =>
    sessionDeletion.finish(token),
  );
  ipcMain.handle('sessions:cancelDeletion', (_event, token: string) =>
    sessionDeletion.cancel(token),
  );

  ipcMain.handle('projects:pin', (_e, id: string, pinned: boolean) => setProjectPinned(id, pinned));

  ipcMain.handle('projects:hide', (_e, id: string, hidden: boolean) =>
    setProjectHidden(id, hidden),
  );

  ipcMain.handle('projects:delete', (_e, id: string) => deleteProject(id));
  ipcMain.handle('projects:deleteMissing', (_e, ids: string[]) => deleteMissingProjects(ids));
  ipcMain.handle('projects:setOrder', (_e, agent: AgentId, ids: string[]) =>
    setProjectOrder(agent, ids),
  );

  ipcMain.handle('sessions:order', (_event, projectId: string) => inspectSessionOrder(projectId));
  ipcMain.handle(
    'sessions:move',
    (_event, projectId: string, from: string, to: string, placement: 'before' | 'after') =>
      moveSessionRow(projectId, from, to, placement),
  );
  ipcMain.handle(
    'sessions:promoteDraft',
    (_event, projectId: string, launchId: string, sessionId: string) =>
      promoteSessionDraft(launchId, projectId, sessionId, true),
  );
  ipcMain.handle('sessions:listForProject', (_e, projectId: string) =>
    listSessionsForProject(projectId),
  );
  ipcMain.handle('sessions:inspectManaged', (_event, terminalKey: string, launchId: string) => {
    if (
      typeof terminalKey !== 'string' ||
      terminalKey.length > 2000 ||
      typeof launchId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(launchId)
    )
      throw new Error('Invalid managed session request.');
    return managedSessions.inspect(terminalKey, launchId);
  });
  ipcMain.handle('sessions:delete', async (_e, projectId: string, sessionId: string) => {
    await deleteSession(projectId, sessionId);
    const agent = projectId.slice(0, projectId.indexOf(':')) as AgentId;
    managedSessions.cancelSession(agent, sessionId);
    void removeSessionOrder(`${agent}:${sessionId}`).catch(() =>
      console.warn('Could not clear deleted session ordering metadata.'),
    );
    void preferences.forgetSessionTitle(agent, sessionId).catch(() => {
      console.warn('Session history was deleted, but clearing its local title metadata failed.');
    });
  });
  ipcMain.handle('sessions:rename', (_e, projectId: string, sessionId: string, title: string) =>
    renameSession(projectId, sessionId, title),
  );

  ipcMain.handle('fs:readDir', (_e, path: string) => readDir(path));
  ipcMain.handle('fs:createFile', (_e, path: string) => createFile(path));
  ipcMain.handle('fs:createDir', (_e, path: string) => createDir(path));
  ipcMain.handle('fs:rename', (_e, oldPath: string, newPath: string) =>
    renamePath(oldPath, newPath),
  );
  ipcMain.handle('fs:copy', (_e, src: string, dest: string) => copyPath(src, dest));
  ipcMain.handle('fs:move', (_e, src: string, dest: string) => movePath(src, dest));
  ipcMain.handle('fs:trash', (_e, path: string) => trashPath(path));
  ipcMain.handle('fs:reveal', (_e, path: string) => revealInExplorer(path));
  ipcMain.handle('fs:openDefault', (_e, path: string) => openWithDefault(path));

  ipcMain.handle('workspace:getRecentFolders', () => readRecentFolders(preferences));
  ipcMain.handle('workspace:repository', (_event, path: string) =>
    inspectWorkspaceRepository(path),
  );
  ipcMain.handle('workspace:getMode', async () => (await preferences.read()).workspaceMode);
  ipcMain.handle('workspace:setMode', (_e, mode: WorkspaceMode) =>
    preferences.setWorkspaceMode(mode),
  );
  ipcMain.handle('activity:snapshot', () => activityRuntime.snapshot());
  ipcMain.handle('activity:codexStatus', () => activityRuntime.codex.inspect());
  ipcMain.handle('activity:configureCodex', async (_event, install: boolean, digest: string) => {
    if (
      typeof install !== 'boolean' ||
      typeof digest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(digest)
    )
      throw new Error('Invalid hook configuration request');
    const status = await activityRuntime.codex.inspect();
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Codex activity hooks',
      message: install
        ? 'Add passive status hooks for Parallel Agents?'
        : 'Remove Parallel Agents status hooks?',
      detail: `${status.path}\nExisting hooks and approvals are retained. A backup is made before changes. Codex may require trusting these hooks through /hooks.`,
      buttons: ['Apply', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (result.response !== 0) return status;
    if (install) await ensureActivityReporter();
    return activityRuntime.codex.apply(install, digest);
  });
  const offActivity = activityRuntime.bridge.subscribe((snapshot) => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed())
      win.webContents.send('activity:changed', snapshot);
  });
  win.once('closed', offActivity);
  ipcMain.handle('pty:spawn', async (_e, opts: PtySpawnOptions) => {
    const agent = commandAgent(opts.initialCommand);
    if (opts.managedLaunch) {
      const launch = opts.managedLaunch;
      if (
        !agent ||
        opts.activitySessionId ||
        opts.shellProfile ||
        !opts.projectId.endsWith('::agent') ||
        typeof launch.projectId !== 'string' ||
        typeof launch.launchId !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(launch.launchId) ||
        (launch.createdAt !== undefined &&
          (!Number.isFinite(launch.createdAt) || launch.createdAt < 0))
      )
        throw new Error('Invalid managed launch.');
      if (launch.sessionTitle !== undefined)
        launch.sessionTitle = validateSessionName(launch.sessionTitle);
    }
    let generation: string | undefined;
    if (
      opts.activitySessionId !== undefined &&
      opts.activitySessionId !== null &&
      !/^[a-zA-Z0-9_.:-]{1,200}$/.test(opts.activitySessionId)
    )
      throw new Error('Invalid activity session identity');
    const prepareCommand = async (command: string | undefined) => {
      const launch = opts.managedLaunch;
      if (launch) {
        const project = (await listProjects()).find(
          (item) => item.id === launch.projectId && item.agent === agent,
        );
        if (!project || project.realPath !== opts.cwd)
          throw new Error('Managed launch checkout is unavailable.');
      }
      const configured = await prepareAgentLaunch(command, {
        load: async () => (await preferences.read()).agentLaunchOptions,
        confirm: async (agent, mode, command) => {
          const result = await dialog.showMessageBox(win, {
            type: 'warning',
            title: `Start ${AGENT_LAUNCH[agent].name} with fewer approvals?`,
            message: mode.label,
            detail: `${mode.description}\n\nWorking folder: ${opts.cwd}\nCommand: ${command}\n\nOnly continue in a trusted project. This setting does not make the CLI safe or grant a sandbox.`,
            buttons: ['Start with this mode', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
          });
          return result.response === 0;
        },
      });
      if (!agent || !configured || opts.shellProfile || !opts.projectId.endsWith('::agent'))
        return configured;
      try {
        const prepared = await activityRuntime.prepare(
          agent,
          opts.projectId,
          opts.activitySessionId ?? null,
          configured,
        );
        generation = prepared.environment.PA_ACTIVITY_TOKEN
          ? activityRuntime
              .snapshot()
              .records.find((record) => record.terminalKey === opts.projectId)?.generation
          : undefined;
        return {
          ...prepared,
          end: (state: 'unknown' | 'failed') => {
            managedSessions.cancel(opts.projectId);
            prepared.end(state);
          },
        };
      } catch (error) {
        console.warn(
          'Agent status hooks unavailable:',
          error instanceof Error ? error.message : String(error),
        );
        return configured;
      }
    };
    const opened = await guardCheckout(
      opts.cwd,
      () =>
        ptyManager.spawn(
          opts.projectId,
          opts.cwd,
          opts.cols,
          opts.rows,
          opts.initialCommand,
          opts.extraPath,
          opts.shellProfile,
          prepareCommand,
        ),
      false,
    );
    if (!opened) return;
    if (opts.managedLaunch && agent)
      managedSessions.register({
        ...opts.managedLaunch,
        terminalKey: opts.projectId,
        agent,
        cwd: opts.cwd,
        generation,
      });
    try {
      await recordRecentFolder(preferences, opts.cwd);
    } catch (error) {
      throw new Error(
        `Terminal opened, but saving folder history failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  });
  ipcMain.handle('pty:write', (_e, projectId: string, data: string) => {
    ptyManager.write(projectId, data);
  });
  ipcMain.handle('pty:resize', (_e, projectId: string, cols: number, rows: number) => {
    ptyManager.resize(projectId, cols, rows);
  });
  ipcMain.handle('pty:kill', (_e, projectId: string) => {
    managedSessions.cancel(projectId);
    ptyManager.kill(projectId);
  });

  ipcMain.handle('dialog:pickDirectory', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Project Folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('agents:list', () => listAgents());
  ipcMain.handle('agents:checkAll', () => checkAllAgents());
  ipcMain.handle(
    'agents:getLaunchSettings',
    async () => (await preferences.read()).agentLaunchOptions,
  );
  ipcMain.handle(
    'agents:setLaunchOptions',
    (_e, agent: AgentId, options: AgentLaunchOptions, acknowledged: boolean) =>
      preferences.setAgentLaunchOptions(agent, options, acknowledged),
  );

  ipcMain.handle('config:getLastAgent', (_e, projectId: string) => getLastAgent(projectId));
  ipcMain.handle('config:setLastAgent', (_e, projectId: string, agentId: AgentId) =>
    setLastAgent(projectId, agentId),
  );
  ipcMain.handle('config:getAgentLayout', () => getAgentLayout());
  ipcMain.handle('config:setAgentOrder', (_e, ids: AgentId[]) => setAgentOrder(ids));
  ipcMain.handle('config:setAgentPinned', (_e, agent: AgentId, pinned: boolean) =>
    setAgentPinned(agent, pinned),
  );
  ipcMain.handle('config:getLayout', () => getLayout());
  ipcMain.handle('config:setLayout', (_e, layout: LayoutConfig) => setLayout(layout));
  ipcMain.handle('config:getTheme', async () => {
    const theme = await getTheme();
    if (process.platform === 'win32') win.setTitleBarOverlay(titleBarOverlayFor(theme));
    return theme;
  });
  ipcMain.handle('config:setTheme', async (_e, theme: ThemeMode) => {
    await setTheme(theme);
    if (process.platform === 'win32') win.setTitleBarOverlay(titleBarOverlayFor(theme));
  });
  ipcMain.handle('config:getConfirmOnCloseTab', () => getConfirmOnCloseTab());
  ipcMain.handle('config:setConfirmOnCloseTab', (_e, v: boolean) => setConfirmOnCloseTab(v));
  ipcMain.handle('config:getTerminalMultilineEnter', () => getTerminalMultilineEnter());
  ipcMain.handle('config:setTerminalMultilineEnter', (_e, v: boolean) =>
    setTerminalMultilineEnter(v),
  );
  ipcMain.handle('config:getTerminalCopyPaste', () => getTerminalCopyPaste());
  ipcMain.handle('config:setTerminalCopyPaste', (_e, v: boolean) => setTerminalCopyPaste(v));
  ipcMain.handle('config:getFontSize', async () => (await preferences.read()).fontSize);
  ipcMain.handle('config:setFontSize', (_e, size: number) => preferences.setFontSize(size));
  ipcMain.handle('config:getFontFamily', async () => (await preferences.read()).fontFamily);
  ipcMain.handle('config:setFontFamily', (_e, fontFamily: string) =>
    preferences.setFontFamily(fontFamily),
  );
  ipcMain.handle('config:getFontBold', async () => (await preferences.read()).fontBold);
  ipcMain.handle('config:setFontBold', (_e, bold: boolean) => preferences.setFontBold(bold));
  ipcMain.handle('shell:list', () => discoverShells());

  ipcMain.handle('git:status', (_e, repoPath: string) => git.getStatus(repoPath));
  ipcMain.handle('git:diff', (_e, repoPath: string, filePath: string, staged: boolean) =>
    git.getDiff(repoPath, filePath, staged),
  );
  ipcMain.handle('git:stage', (_e, repoPath: string, files: string[]) =>
    git.stage(repoPath, files),
  );
  ipcMain.handle('git:unstage', (_e, repoPath: string, files: string[]) =>
    git.unstage(repoPath, files),
  );
  ipcMain.handle('git:discard', (_e, repoPath: string, files: string[]) =>
    git.discard(repoPath, files),
  );
  ipcMain.handle('git:commit', (_e, repoPath: string, message: string) =>
    git.commit(repoPath, message),
  );
  ipcMain.handle('git:watch', (_e, repoPath: string) => git.watchRepo(repoPath));

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    await shell.openExternal(url);
  });
}
