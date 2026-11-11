import type { AgentId, Session } from '../shared/types.ts';
import type { SessionActivity } from '../shared/session-activity.ts';
import type { ManagedSessionResult } from '../shared/managed-session.ts';

export interface ManagedLaunch {
  terminalKey: string;
  launchId: string;
  projectId: string;
  agent: AgentId;
  cwd: string;
  generation?: string;
  sessionTitle?: string;
  createdAt?: number;
  nativeSessionId?: string;
}
interface Entry extends ManagedLaunch {
  sessionId?: string;
  binding?: Promise<void>;
}
interface Options {
  activity: () => SessionActivity[];
  list: (projectId: string) => Promise<Session[]>;
  samePath: (left: string, right: string) => Promise<boolean>;
  onRegister?: (launch: ManagedLaunch) => void;
  onCancel?: (launchId: string) => void;
  onBound?: (launchId: string, projectId: string, sessionId: string) => Promise<void>;
}

/** Correlates launch identity only. No prompts, CLI probes or model requests. */
export class ManagedSessionService {
  private entries = new Map<string, Entry>();
  private options: Options;
  constructor(options: Options) {
    this.options = options;
  }
  register(launch: ManagedLaunch): void {
    this.cancel(launch.terminalKey);
    this.entries.set(launch.terminalKey, { ...launch });
    this.options.onRegister?.(launch);
  }
  cancel(terminalKey: string): void {
    const entry = this.entries.get(terminalKey);
    this.entries.delete(terminalKey);
    if (entry) this.options.onCancel?.(entry.launchId);
  }
  cancelSession(agent: AgentId, sessionId: string): void {
    for (const entry of this.entries.values())
      if (entry.agent === agent && entry.sessionId === sessionId) this.cancel(entry.terminalKey);
  }
  close(): void {
    for (const key of this.entries.keys()) this.cancel(key);
  }
  private current(entry: Entry): boolean {
    return this.entries.get(entry.terminalKey) === entry;
  }
  async inspect(terminalKey: string, launchId: string): Promise<ManagedSessionResult> {
    const entry = this.entries.get(terminalKey);
    if (!entry || entry.launchId !== launchId || !entry.generation) return { session: null };
    const proof = this.options
      .activity()
      .find(
        (record) =>
          record.terminalKey === terminalKey &&
          record.agent === entry.agent &&
          record.generation === entry.generation,
      );
    if (!proof?.sessionId || !this.current(entry)) return { session: null };
    const session = (await this.options.list(entry.projectId)).find(
      (item) => item.id === proof.sessionId && item.agent === entry.agent,
    );
    if (
      !session?.cwd ||
      !(await this.options.samePath(session.cwd, entry.cwd)) ||
      !this.current(entry)
    )
      return { session: null };
    if (
      [...this.entries.values()].some(
        (other) => other !== entry && other.agent === entry.agent && other.sessionId === session.id,
      )
    )
      return { session: null };
    entry.sessionId = session.id;
    if (!entry.nativeSessionId && !entry.binding) {
      entry.binding = Promise.resolve(
        this.options.onBound?.(entry.launchId, entry.projectId, session.id),
      )
        .then(() => {
          if (this.current(entry)) entry.nativeSessionId = session.id;
        })
        .finally(() => {
          entry.binding = undefined;
        });
    }
    await entry.binding;
    if (!this.current(entry)) return { session: null };
    const named = (await this.options.list(entry.projectId)).find(
      (item) => item.id === session.id && item.agent === entry.agent,
    );
    return { session: this.current(entry) ? (named ?? session) : null };
  }
}
