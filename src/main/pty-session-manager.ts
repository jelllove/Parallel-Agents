import type { BrowserWindow } from 'electron';
import type { IPty, spawn } from 'node-pty';
import { sendToWindow } from './window-messenger.ts';

interface Entry {
  pty: IPty;
  cwd: string;
  commandTimer?: ReturnType<typeof setTimeout>;
}

export class PtyManager {
  private ptys = new Map<string, Entry>();
  private win: BrowserWindow | null = null;
  private readonly createPty: typeof spawn;

  constructor(createPty: typeof spawn) {
    this.createPty = createPty;
  }

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
  ): void {
    if (this.ptys.has(projectId)) return;

    const shell = process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL || 'bash';
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    if (extraPath && extraPath.length > 0) {
      const sep = process.platform === 'win32' ? ';' : ':';
      const pathKey =
        process.platform === 'win32'
          ? (Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'Path')
          : 'PATH';
      const existing = env[pathKey] || '';
      env[pathKey] = [...extraPath, existing].filter(Boolean).join(sep);
    }
    const p = this.createPty(shell, [], {
      name: 'xterm-256color',
      cols: Math.max(cols, 20),
      rows: Math.max(rows, 5),
      cwd,
      env,
    });
    const entry: Entry = { pty: p, cwd };
    this.ptys.set(projectId, entry);

    p.onData((data) => {
      if (this.ptys.get(projectId) !== entry) return;
      sendToWindow(this.win, 'pty:data', projectId, data);
    });
    p.onExit(({ exitCode }) => {
      if (this.ptys.get(projectId) !== entry) return;
      clearTimeout(entry.commandTimer);
      this.ptys.delete(projectId);
      sendToWindow(this.win, 'pty:exit', projectId, exitCode);
    });

    if (initialCommand) {
      entry.commandTimer = setTimeout(() => {
        if (this.ptys.get(projectId) === entry) p.write(initialCommand + '\r');
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
    } catch (error) {
      console.warn(`Cannot resize terminal ${projectId}`, error);
    }
  }

  kill(projectId: string): void {
    const e = this.ptys.get(projectId);
    if (!e) return;
    clearTimeout(e.commandTimer);
    this.ptys.delete(projectId);
    try {
      e.pty.kill();
    } catch (error) {
      console.warn(`Cannot terminate terminal ${projectId}`, error);
    }
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) this.kill(id);
  }

  has(projectId: string): boolean {
    return this.ptys.has(projectId);
  }
}
