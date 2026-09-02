import { BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { sendToWindow } from './window-messenger';
import { resolveShellLaunch } from './shell-profiles';
import type { SessionShellProfile } from '../shared/session-terminals';

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

  detachWindow(): void {
    this.win = null;
  }

  spawn(
    projectId: string,
    cwd: string,
    cols: number,
    rows: number,
    initialCommand?: string,
    extraPath?: string[],
    shellProfile?: SessionShellProfile,
  ): void {
    if (this.ptys.has(projectId)) return;

    const launch = shellProfile
      ? resolveShellLaunch(process.platform, shellProfile, process.env.SHELL ?? null)
      : {
          command: process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL || 'bash',
          args: [] as string[],
        };
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
      sendToWindow(this.win, 'pty:data', projectId, data);
    });
    p.onExit(({ exitCode }) => {
      sendToWindow(this.win, 'pty:exit', projectId, exitCode);
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
