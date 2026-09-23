export type SessionActivity = 'running' | 'waiting' | 'done';
export type IdleClassification = SessionActivity | 'stopped';

export const IDLE_AFTER_MS = 2500;
const TAIL_CHARS = 600;
const MIN_BURST_CHARS = 24;

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

// cmd.exe `C:\x>`, PowerShell `PS C:\x>`, and POSIX `user@host:~/x$` prompts mean the agent exited.
const SHELL_PROMPT = /^(?:PS )?[A-Za-z]:\\[^<>|"]*>\s*$|^[\w.-]+@[\w.-]+:[^$#]*[$#]\s*$/;

const LAST_LINE_WAITING = [
  /\?\s*$/,
  /\(y\/n\)|\[y\/n\]|\(yes\/no\)/i,
  /press enter|enter to confirm|to continue\b/i,
  /›\s*$/,
];

// Interactive pickers render their question above a short numbered list.
const MENU_WAITING = [/❯\s*\d+\./, /select an? (option|choice)/i, /do you want to|would you like/i];

export function classifyIdleOutput(tail: string): IdleClassification {
  const lines = stripAnsi(tail)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines.at(-1) ?? '';
  if (SHELL_PROMPT.test(last)) return 'stopped';
  if (LAST_LINE_WAITING.some((pattern) => pattern.test(last))) return 'waiting';
  const menu = lines.slice(-4).join('\n');
  if (/❯\s*\d+\./.test(menu) && MENU_WAITING.some((pattern) => pattern.test(menu))) {
    return 'waiting';
  }
  return 'done';
}

export interface ActivityTrackerDeps<Timer> {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => Timer;
  clearTimer: (timer: Timer) => void;
  onChange: (key: string, state: SessionActivity | null) => void;
}

export function createActivityTracker<Timer>(deps: ActivityTrackerDeps<Timer>) {
  const tails = new Map<string, string>();
  const timers = new Map<string, Timer>();
  const states = new Map<string, SessionActivity>();
  const pending = new Map<string, number>();
  const awaitingReply = new Set<string>();

  function set(key: string, state: SessionActivity | null) {
    if ((states.get(key) ?? null) === state) return;
    if (state) states.set(key, state);
    else states.delete(key);
    deps.onChange(key, state);
  }

  function settle(key: string) {
    timers.delete(key);
    pending.delete(key);
    const result = classifyIdleOutput(tails.get(key) ?? '');
    set(key, result === 'stopped' ? null : result);
  }

  return {
    input(key: string) {
      pending.set(key, 0);
      awaitingReply.add(key);
    },
    output(key: string, data: string) {
      const tail = ((tails.get(key) ?? '') + data).slice(-TAIL_CHARS);
      tails.set(key, tail);
      const burst = (pending.get(key) ?? 0) + stripAnsi(data).trim().length;
      pending.set(key, burst);
      const replying = awaitingReply.has(key) && burst > 0;
      if (states.get(key) !== 'running' && !replying && burst < MIN_BURST_CHARS) return;
      awaitingReply.delete(key);
      set(key, 'running');
      const existing = timers.get(key);
      if (existing !== undefined) deps.clearTimer(existing);
      timers.set(
        key,
        deps.setTimer(() => settle(key), IDLE_AFTER_MS),
      );
    },
    exit(key: string) {
      const existing = timers.get(key);
      if (existing !== undefined) deps.clearTimer(existing);
      timers.delete(key);
      tails.delete(key);
      pending.delete(key);
      awaitingReply.delete(key);
      set(key, null);
    },
  };
}
