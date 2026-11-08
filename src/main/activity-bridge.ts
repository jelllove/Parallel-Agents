import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, unlink, rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentId } from '../shared/types.ts';
import { activityFromHook } from '../shared/session-activity.ts';
import type { ActivityState, SessionActivity } from '../shared/session-activity.ts';

export interface ActivitySnapshot {
  revision: number;
  records: SessionActivity[];
}
interface Registration {
  turnId?: string;
  record: SessionActivity;
  count: number;
  window: number;
}
export class ActivityBridge {
  readonly endpoint: string;
  private server: Server | null = null;
  private revision = 0;
  private registrations = new Map<string, Registration>();
  private records = new Map<string, SessionActivity>();
  private sockets = new Set<Socket>();
  private listeners = new Set<(snapshot: ActivitySnapshot) => void>();
  private directory: string;
  private socketDirectory?: string;
  constructor(directory: string) {
    this.directory = directory;
    const id = randomBytes(16).toString('hex');
    if (process.platform !== 'win32') this.socketDirectory = mkdtempSync('/tmp/pa-status-');
    this.endpoint =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\parallel-agents-${id}`
        : join(this.socketDirectory!, 'events.sock');
  }
  async start() {
    if (this.server) return;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (this.socketDirectory) await chmod(this.socketDirectory, 0o700);
    const server = createServer((socket) => {
      if (this.sockets.size >= 32) {
        socket.destroy();
        return;
      }
      this.sockets.add(socket);
      socket.setTimeout(1500, () => socket.destroy());
      let input = '';
      let handled = false;
      socket.on('data', (chunk) => {
        if (handled) return;
        input += chunk.toString('utf8');
        if (Buffer.byteLength(input) > 8192) {
          socket.destroy();
          return;
        }
        const newline = input.indexOf('\n');
        if (newline < 0) return;
        handled = true;
        try {
          this.receive(JSON.parse(input.slice(0, newline)));
        } catch {
          /* Invalid reports are ignored. */
        }
        socket.end();
      });
      socket.on('error', () => socket.destroy());
      socket.on('close', () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.endpoint, resolve);
    });
    if (process.platform !== 'win32') await chmod(this.endpoint, 0o600);
    this.server = server;
  }
  register(terminalKey: string, agent: AgentId, sessionId: string | null) {
    for (const [token, registration] of this.registrations)
      if (registration.record.terminalKey === terminalKey) this.revoke(token);
    if (this.registrations.size >= 256) throw new Error('Too many observed agent launches');
    const token = randomBytes(32).toString('hex');
    const record: SessionActivity = {
      terminalKey,
      agent,
      sessionId,
      generation: randomBytes(16).toString('hex'),
      state: 'unknown',
      revision: 0,
    };
    this.registrations.set(token, { record, count: 0, window: Date.now() });
    this.update(record, 'unknown');
    return { token, generation: record.generation };
  }
  revoke(token: string, state: ActivityState = 'unknown') {
    const registration = this.registrations.get(token);
    if (!registration) return;
    this.registrations.delete(token);
    this.update(registration.record, state);
  }
  private receive(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const payload = value as Record<string, unknown>;
    if (
      typeof payload.token !== 'string' ||
      typeof payload.event !== 'string' ||
      payload.event.length > 60
    )
      return;
    const registration = this.registrations.get(payload.token);
    if (!registration) return;
    if (Date.now() - registration.window > 1000) {
      registration.window = Date.now();
      registration.count = 0;
    }
    if (++registration.count > 100) return;
    if (
      typeof payload.sessionId !== 'string' ||
      !/^[a-zA-Z0-9_.:-]{1,200}$/.test(payload.sessionId)
    )
      return;
    const { record } = registration;
    if (record.sessionId && record.sessionId !== payload.sessionId) return;
    if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) return;
    const state = activityFromHook(
      record.agent,
      payload.event,
      payload.data as Record<string, unknown>,
    );
    if (!state) return;
    if (payload.turnId !== undefined) {
      if (typeof payload.turnId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(payload.turnId))
        return;
      if (['UserPromptSubmit', 'userPromptSubmitted'].includes(payload.event))
        registration.turnId = payload.turnId;
      else if (registration.turnId && registration.turnId !== payload.turnId) return;
    }
    record.sessionId = payload.sessionId;
    if (payload.event === 'SessionEnd' || payload.event === 'sessionEnd')
      this.revoke(payload.token, state);
    else this.update(record, state);
  }
  private update(record: SessionActivity, state: ActivityState) {
    record.state = state;
    record.revision = ++this.revision;
    this.records.set(record.terminalKey, { ...record });
    if (this.records.size > 256) this.records.delete(this.records.keys().next().value!);
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
  snapshot(): ActivitySnapshot {
    return {
      revision: this.revision,
      records: [...this.records.values()].map((record) => ({ ...record })),
    };
  }
  subscribe(listener: (snapshot: ActivitySnapshot) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  async close() {
    for (const token of this.registrations.keys()) this.revoke(token);
    for (const socket of this.sockets) socket.destroy();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (process.platform !== 'win32') await unlink(this.endpoint).catch(() => {});
    if (this.socketDirectory) await rm(this.socketDirectory, { recursive: true, force: true });
    this.listeners.clear();
  }
}
