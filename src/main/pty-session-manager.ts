import type { BrowserWindow } from 'electron';
import type { IPty, spawn } from 'node-pty';
import { posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PtyOutputFlow } from './pty-output-flow.ts';
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
  output?: PtyOutputFlow;
  cols?: number;
  rows?: number;
  exited?: boolean;
}

export class PtyManager {
  private ptys = new Map<string, Entry>();
  private draining = new Map<string, Entry>();
  private starting = new Map<string, symbol>();
  private startingCwds = new Map<string, string>();
  private closing = new Set<{ cwd: string; exited: Promise<void> }>();
  private exits = new WeakMap<Entry, Promise<void>>();
  private win: BrowserWindow | null = null;
  private outputEnabled = true;
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
    this.outputEnabled = true;
  }

  detachWindow(): void {
    this.outputEnabled = false;
    for (const entry of this.ptys.values()) entry.output?.dispose();
    for (const entry of this.draining.values()) entry.output?.dispose();
    this.draining.clear();
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
    this.startingCwds.set(projectId, cwd);

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
      const entry: Entry = {
        pty: p,
        cwd,
        observer,
        cols: Math.max(cols, 20),
        rows: Math.max(rows, 5),
      };
      entry.output = new PtyOutputFlow(
        {
          send: (data, packet) => sendToWindow(this.win, 'pty:data', projectId, data, packet),
          pause: () => {
            try {
              p.pause();
            } catch (error) {
              console.warn('Cannot pause terminal output', error);
            }
          },
          resume: () => {
            try {
              if (!entry.exited) p.resume();
            } catch (error) {
              console.warn('Cannot resume terminal output', error);
            }
          },
        },
        randomUUID(),
      );
      this.draining.get(projectId)?.output?.dispose();
      this.draining.delete(projectId);
      this.ptys.set(projectId, entry);
      attached = true;

      p.onData((data) => {
        if (!this.outputEnabled || this.ptys.get(projectId) !== entry) return;
        entry.output!.push(data);
      });
      let resolveExit!: () => void;
      this.exits.set(
        entry,
        new Promise<void>((resolve) => {
          resolveExit = resolve;
        }),
      );
      p.onExit(({ exitCode }) => {
        this.exits.delete(entry);
        resolveExit();
        if (this.ptys.get(projectId) !== entry) return;
        clearTimeout(entry.commandTimer);
        entry.exited = true;
        this.ptys.delete(projectId);
        entry.observer?.end(exitCode === 0 ? 'unknown' : 'failed');
        this.draining.set(projectId, entry);
        // Exit is enqueued after the last output packet, without flooding IPC past the watermark.
        entry.output!.finish(() => {
          if (this.draining.get(projectId) !== entry) return;
          this.draining.delete(projectId);
          entry.output!.dispose();
          sendToWindow(this.win, 'pty:exit', projectId, exitCode);
        });
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
          if (this.ptys.get(projectId) !== entry) return;
          try {
            p.write(command + '\r');
          } catch (error) {
            console.warn(`Cannot send initial command to terminal ${projectId}`, error);
            entry.output?.push('\r\n[Failed to send initial command to terminal]\r\n');
            entry.observer?.end('failed');
          }
        }, 250);
      }
      return true;
    } finally {
      if (!attached) observer?.end(this.starting.get(projectId) === token ? 'failed' : 'unknown');
      if (this.starting.get(projectId) === token) {
        this.starting.delete(projectId);
        this.startingCwds.delete(projectId);
      }
    }
  }

  write(projectId: string, data: string): void {
    this.ptys.get(projectId)?.pty.write(data);
  }

  acknowledgeOutput(projectId: string, generation: string, sequence: number): void {
    const entry = this.ptys.get(projectId) ?? this.draining.get(projectId);
    entry?.output?.acknowledge(generation, sequence);
  }

  resize(projectId: string, cols: number, rows: number): void {
    const e = this.ptys.get(projectId);
    if (!e) return;
    cols = Math.max(cols, 20);
    rows = Math.max(rows, 5);
    if (e.cols === cols && e.rows === rows) return;
    try {
      e.pty.resize(cols, rows);
      e.cols = cols;
      e.rows = rows;
    } catch (error) {
      console.warn(`Cannot resize terminal ${projectId}`, error);
    }
  }

  kill(projectId: string): void {
    this.starting.delete(projectId);
    this.startingCwds.delete(projectId);
    this.draining.get(projectId)?.output?.dispose();
    this.draining.delete(projectId);
    const e = this.ptys.get(projectId);
    if (!e) return;
    clearTimeout(e.commandTimer);
    e.output?.dispose();
    this.ptys.delete(projectId);
    e.observer?.end('unknown');
    const closing = { cwd: e.cwd, exited: this.exits.get(e) ?? Promise.resolve() };
    this.closing.add(closing);
    void closing.exited.then(() => this.closing.delete(closing));
    try {
      e.pty.kill();
    } catch (error) {
      console.warn(`Cannot terminate terminal ${projectId}`, error);
    }
  }

  killAll(): void {
    this.starting.clear();
    this.startingCwds.clear();
    for (const id of new Set([...this.ptys.keys(), ...this.draining.keys()])) this.kill(id);
  }

  async waitForCheckoutIdle(
    contains: (cwd: string) => Promise<boolean>,
    timeoutMs = 5000,
  ): Promise<void> {
    for (const cwd of [
      ...this.startingCwds.values(),
      ...[...this.ptys.values()].map((entry) => entry.cwd),
    ])
      if (await contains(cwd)) throw new Error('Worktree still has an open or starting terminal.');
    const waits: Promise<void>[] = [];
    for (const entry of this.closing) if (await contains(entry.cwd)) waits.push(entry.exited);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(waits),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Timed out waiting for worktree terminals to exit.')),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  has(projectId: string): boolean {
    return this.ptys.has(projectId);
  }
}
