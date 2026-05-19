import { BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';

interface Entry {
  pty: IPty;
  cwd: string;
}

class PtyManager {
  private ptys = new Map<string, Entry>();
  private win: BrowserWindow | null = null;

  attachWindow(win: BrowserWindow) {
    this.win = win;
  }

  spawn(projectId: string, cwd: string, cols: number, rows: number, initialCommand?: string): void {
    if (this.ptys.has(projectId)) return;

    const shell = process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL || 'bash';
    const p = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: Math.max(cols, 20),
      rows: Math.max(rows, 5),
      cwd,
      env: { ...process.env } as { [key: string]: string },
    });

    p.onData((data) => {
      this.win?.webContents.send('pty:data', projectId, data);
    });
    p.onExit(({ exitCode }) => {
      this.win?.webContents.send('pty:exit', projectId, exitCode);
      this.ptys.delete(projectId);
    });

    this.ptys.set(projectId, { pty: p, cwd });

    if (initialCommand) {
      setTimeout(() => {
        this.ptys.get(projectId)?.pty.write(initialCommand + '\r');
      }, 250);
    }
  }

  write(projectId: string, data: string): void {
    this.ptys.get(projectId)?.pty.write(data);
  }

  resize(projectId: string, cols: number, rows: number): void {
    const e = this.ptys.get(projectId);
    if (!e) return;
    try {
      e.pty.resize(Math.max(cols, 20), Math.max(rows, 5));
    } catch {}
  }

  kill(projectId: string): void {
    const e = this.ptys.get(projectId);
    if (!e) return;
    try {
      e.pty.kill();
    } catch {}
    this.ptys.delete(projectId);
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) this.kill(id);
  }

  has(projectId: string): boolean {
    return this.ptys.has(projectId);
  }
}

export const ptyManager = new PtyManager();
