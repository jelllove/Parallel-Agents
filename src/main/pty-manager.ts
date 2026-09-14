import { BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { sendToWindow } from './window-messenger';
import { resolveAvailableShell } from './shell-profiles';
import type { SessionShellProfile } from '../shared/session-terminals';

interface Entry {
  pty: IPty;
  cwd: string;
}

class PtyManager {
  private ptys = new Map<string, Entry>();
  private starting = new Map<string, symbol>();
  private win: BrowserWindow | null = null;

  attachWindow(win: BrowserWindow) {
    this.win = win;
  }

  detachWindow(): void {
    this.win = null;
  }

  async spawn(
    projectId: string,
    cwd: string,
    cols: number,
    rows: number,
    initialCommand?: string,
    extraPath?: string[],
    shellProfile?: SessionShellProfile,
  ): Promise<void> {
    if (this.ptys.has(projectId) || this.starting.has(projectId)) return;
    const token = Symbol();
    this.starting.set(projectId, token);

    try {
      const launch = shellProfile
        ? await resolveAvailableShell(shellProfile)
        : {
            command: process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL || 'bash',
            args: [] as string[],
          };
      if (this.starting.get(projectId) !== token) return;
      const env: { [key: string]: string } = { ...process.env } as { [key: string]: string };
      if (extraPath && extraPath.length > 0) {
        const sep = process.platform === 'win32' ? ';' : ':';
        const pathKey = process.platform === 'win32'
          ? Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'Path'
          : 'PATH';
        const existing = env[pathKey] || '';
        env[pathKey] = [...extraPath, existing].filter(Boolean).join(sep);
      }
      const p = pty.spawn(launch.command, launch.args, {
        name: 'xterm-256color',
        cols: Math.max(cols, 20),
        rows: Math.max(rows, 5),
        cwd,
        env,
      });

      p.onData((data) => {
        if (this.ptys.get(projectId)?.pty === p) sendToWindow(this.win, 'pty:data', projectId, data);
      });
      p.onExit(({ exitCode }) => {
        if (this.ptys.get(projectId)?.pty !== p) return;
        sendToWindow(this.win, 'pty:exit', projectId, exitCode);
        this.ptys.delete(projectId);
      });

      this.ptys.set(projectId, { pty: p, cwd });

      if (initialCommand) {
        setTimeout(() => {
          if (this.ptys.get(projectId)?.pty === p) p.write(initialCommand + '\r');
        }, 250);
      }
    } finally {
      if (this.starting.get(projectId) === token) this.starting.delete(projectId);
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
    this.starting.delete(projectId);
    const e = this.ptys.get(projectId);
    if (!e) return;
    try {
      e.pty.kill();
    } catch {}
    this.ptys.delete(projectId);
  }

  killAll(): void {
    this.starting.clear();
    for (const id of [...this.ptys.keys()]) this.kill(id);
  }

  has(projectId: string): boolean {
    return this.ptys.has(projectId);
  }
}

export const ptyManager = new PtyManager();
