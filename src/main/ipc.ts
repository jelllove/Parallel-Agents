import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { listProjects } from './projects';
import { listSessionsForProject } from './sessions';
import { readDir } from './fs-explorer';
import { loadConfig, saveConfig } from './config';
import { ptyManager } from './pty-manager';

export function registerIpc(win: BrowserWindow) {
  ptyManager.attachWindow(win);

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

  ipcMain.handle('sessions:listForProject', (_e, projectId: string) =>
    listSessionsForProject(projectId),
  );

  ipcMain.handle('fs:readDir', (_e, path: string) => readDir(path));

  ipcMain.handle('pty:spawn', (_e, opts: { projectId: string; cwd: string; cols: number; rows: number; initialCommand?: string }) => {
    ptyManager.spawn(opts.projectId, opts.cwd, opts.cols, opts.rows, opts.initialCommand);
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

  const execAsync = promisify(exec);
  ipcMain.handle('claude:check', async () => {
    const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
    try {
      const { stdout } = await execAsync(cmd);
      const path = stdout.split(/\r?\n/).find(Boolean)?.trim() || null;
      return { available: !!path, path };
    } catch {
      return { available: false, path: null };
    }
  });

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    await shell.openExternal(url);
  });
}
