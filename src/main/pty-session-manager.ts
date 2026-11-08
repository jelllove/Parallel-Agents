import type { BrowserWindow } from 'electron';
import type { IPty, spawn } from 'node-pty';
import { posix } from 'node:path';
import { resolveAvailableShell, resolveShellLaunch } from './shell-profiles.ts';
import { sendToWindow } from './window-messenger.ts';
import type { SessionShellProfile } from '../shared/session-terminals.ts';

export interface PreparedPtyCommand {
  command: string | undefined;
  environment: Record<string, string>;
  end: (state: 'unknown' | 'failed') => void;
}
interface Entry {
  observer?: PreparedPtyCommand;
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
    prepareCommand?: (
      command: string | undefined,
    ) => Promise<string | undefined | PreparedPtyCommand>,
  ): Promise<boolean> {
    if (this.ptys.has(projectId) || this.starting.has(projectId)) return false;
    const token = Symbol();
    this.starting.set(projectId, token);

    let observer: PreparedPtyCommand | undefined;
    let attached = false;
    try {
      if (prepareCommand) {
        const prepared = await prepareCommand(initialCommand);
        if (prepared && typeof prepared === 'object') {
          observer = prepared;
          initialCommand = prepared.command;
        } else initialCommand = prepared;
      }
      if (this.starting.get(projectId) !== token) return false;
      const launch = shellProfile
        ? await resolveAvailableShell(shellProfile)
        : resolveShellLaunch(this.environment.platform, 'cmd', this.environment.env.SHELL ?? null);
      if (this.starting.get(projectId) !== token) return false;

      const env = Object.fromEntries(
        Object.entries(this.environment.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      );
      delete env.PA_ACTIVITY_ENDPOINT;
      delete env.PA_ACTIVITY_TOKEN;
      Object.assign(env, observer?.environment);
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
      const entry: Entry = { pty: p, cwd, observer };
      this.ptys.set(projectId, entry);
      attached = true;

      p.onData((data) => {
        if (this.ptys.get(projectId) !== entry) return;
        sendToWindow(this.win, 'pty:data', projectId, data);
      });
      p.onExit(({ exitCode }) => {
        if (this.ptys.get(projectId) !== entry) return;
        clearTimeout(entry.commandTimer);
        this.ptys.delete(projectId);
        entry.observer?.end(exitCode === 0 ? 'unknown' : 'failed');
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
      return true;
    } finally {
      if (!attached) observer?.end(this.starting.get(projectId) === token ? 'failed' : 'unknown');
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
    e.observer?.end('unknown');
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
