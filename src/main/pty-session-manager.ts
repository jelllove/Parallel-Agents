import type { BrowserWindow } from 'electron';
import type { IPty, spawn } from 'node-pty';
import { posix } from 'node:path';
import { resolveAvailableShell, resolveShellLaunch } from './shell-profiles.ts';
import { sendToWindow } from './window-messenger.ts';
import type { SessionShellProfile } from '../shared/session-terminals.ts';

interface Entry {
  pty: IPty;
  cwd: string;
  commandTimer?: ReturnType<typeof setTimeout>;
}

export class PtyManager {
  private ptys = new Map<string, Entry>();
  private starting = new Map<string, symbol>();
  private win: BrowserWindow | null = null;
  private readonly createPty: typeof spawn;
  private readonly environment: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv };

  constructor(
    createPty: typeof spawn,
    environment: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv } = {
      platform: process.platform,
      env: process.env,
    },
  ) {
    this.createPty = createPty;
    this.environment = environment;
  }

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
        : resolveShellLaunch(this.environment.platform, 'cmd', this.environment.env.SHELL ?? null);
      if (this.starting.get(projectId) !== token) return;

      const env = Object.fromEntries(
        Object.entries(this.environment.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      );
      if (extraPath && extraPath.length > 0) {
        const sep = this.environment.platform === 'win32' ? ';' : ':';
        const pathKey =
          this.environment.platform === 'win32'
            ? (Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'Path')
            : 'PATH';
        const existing = env[pathKey] || '';
        env[pathKey] = [...extraPath, existing].filter(Boolean).join(sep);
      }
      const p = this.createPty(launch.command, launch.args, {
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
        // Login profiles can replace PATH after node-pty receives its environment.
        let command = initialCommand;
        if (this.environment.platform !== 'win32' && extraPath?.length) {
          const assignment = `PATH=${env.PATH}`;
          const shell = posix.basename(launch.command);
          const quoted =
            shell === 'pwsh'
              ? `'${assignment.replace(/'/g, "''")}'`
              : shell === 'nu'
                ? JSON.stringify(assignment)
                : `'${assignment.replace(/'/g, "'\\''")}'`;
          command = `/usr/bin/env ${quoted} ${initialCommand}`;
        }
        entry.commandTimer = setTimeout(() => {
          if (this.ptys.get(projectId) === entry) p.write(command + '\r');
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
    } catch (error) {
      console.warn(`Cannot resize terminal ${projectId}`, error);
    }
  }

  kill(projectId: string): void {
    this.starting.delete(projectId);
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
    this.starting.clear();
    for (const id of [...this.ptys.keys()]) this.kill(id);
  }

  has(projectId: string): boolean {
    return this.ptys.has(projectId);
  }
}
