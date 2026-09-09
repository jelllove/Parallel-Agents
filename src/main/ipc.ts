import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import { listProjects, deleteProject, deleteMissingProjects } from './projects';
import { listSessionsForProject, deleteSession } from './sessions';
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
} from './fs-explorer';
import { loadConfig, saveConfig, setLastAgent, getLastAgent, setProjectOrder, getLayout, setLayout, getTheme, setTheme, getConfirmOnCloseTab, setConfirmOnCloseTab, getTerminalMultilineEnter, setTerminalMultilineEnter, getTerminalCopyPaste, setTerminalCopyPaste } from './config';
import { ptyManager } from './pty-manager';
import { checkAllAgents, listAgents } from './agent-providers';
import * as git from './git';
import type { AgentId, LayoutConfig, ThemeMode } from '../shared/types';

export function registerIpc(win: BrowserWindow) {
  ptyManager.attachWindow(win);
  git.attachWindow(win);

  ipcMain.handle('projects:list', () => listProjects());

  ipcMain.handle('projects:pin', async (_e, id: string, pinned: boolean) => {
    const cfg = await loadConfig();
    const set = new Set(cfg.pinned);
    if (pinned) set.add(id); else set.delete(id);
    await saveConfig({ ...cfg, pinned: [...set] });
  });

  ipcMain.handle('projects:hide', async (_e, id: string, hidden: boolean) => {
    const cfg = await loadConfig();
    const set = new Set(cfg.hidden);
    if (hidden) set.add(id); else set.delete(id);
    await saveConfig({ ...cfg, hidden: [...set] });
  });

  ipcMain.handle('projects:delete', (_e, id: string) => deleteProject(id));
  ipcMain.handle('projects:deleteMissing', (_e, ids: string[]) => deleteMissingProjects(ids));
  ipcMain.handle('projects:setOrder', (_e, agent: AgentId, ids: string[]) =>
    setProjectOrder(agent, ids),
  );

  ipcMain.handle('sessions:listForProject', (_e, projectId: string) =>
    listSessionsForProject(projectId),
  );
  ipcMain.handle('sessions:delete', (_e, projectId: string, sessionId: string) =>
    deleteSession(projectId, sessionId),
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

  ipcMain.handle('pty:spawn', (_e, opts: { projectId: string; cwd: string; cols: number; rows: number; initialCommand?: string; extraPath?: string[]; shellProfile?: 'default' | 'powershell' | 'bash' | 'cmd' }) => {
    ptyManager.spawn(
      opts.projectId,
      opts.cwd,
      opts.cols,
      opts.rows,
      opts.initialCommand,
      opts.extraPath,
      opts.shellProfile,
    );
  });
  ipcMain.handle('pty:write', (_e, projectId: string, data: string) => {
    ptyManager.write(projectId, data);
  });
  ipcMain.handle('pty:resize', (_e, projectId: string, cols: number, rows: number) => {
    ptyManager.resize(projectId, cols, rows);
  });
  ipcMain.handle('pty:kill', (_e, projectId: string) => {
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

  ipcMain.handle('config:getLastAgent', (_e, projectId: string) => getLastAgent(projectId));
  ipcMain.handle('config:setLastAgent', (_e, projectId: string, agentId: AgentId) =>
    setLastAgent(projectId, agentId),
  );
  ipcMain.handle('config:getLayout', () => getLayout());
  ipcMain.handle('config:setLayout', (_e, layout: LayoutConfig) => setLayout(layout));
  ipcMain.handle('config:getTheme', () => getTheme());
  ipcMain.handle('config:setTheme', (_e, theme: ThemeMode) => setTheme(theme));
  ipcMain.handle('config:getConfirmOnCloseTab', () => getConfirmOnCloseTab());
  ipcMain.handle('config:setConfirmOnCloseTab', (_e, v: boolean) => setConfirmOnCloseTab(v));
  ipcMain.handle('config:getTerminalMultilineEnter', () => getTerminalMultilineEnter());
  ipcMain.handle('config:setTerminalMultilineEnter', (_e, v: boolean) => setTerminalMultilineEnter(v));
  ipcMain.handle('config:getTerminalCopyPaste', () => getTerminalCopyPaste());
  ipcMain.handle('config:setTerminalCopyPaste', (_e, v: boolean) => setTerminalCopyPaste(v));

  ipcMain.handle('git:status', (_e, repoPath: string) => git.getStatus(repoPath));
  ipcMain.handle('git:diff', (_e, repoPath: string, filePath: string, staged: boolean) =>
    git.getDiff(repoPath, filePath, staged),
  );
  ipcMain.handle('git:stage', (_e, repoPath: string, files: string[]) => git.stage(repoPath, files));
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
