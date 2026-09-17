import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { normalize } from 'node:path';
import { createInterface } from 'node:readline';

type JsonRecord = Record<string, unknown>;

export interface ClaudeSessionMeta {
  title: string;
  timestamp: number;
  cwd: string | null;
  gitBranch: string | null;
  version: string | null;
}

export interface CopilotSessionMeta extends ClaudeSessionMeta {
  sessionId: string | null;
  projectPath: string;
}

export type CopilotSessionStartMeta = Pick<
  CopilotSessionMeta,
  'sessionId' | 'projectPath' | 'timestamp'
>;

export interface GeminiSessionMeta {
  sessionId: string;
  title: string;
  timestamp: number;
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function timestamp(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function trimTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, ' ');
  return title.length > 80 ? title.slice(0, 80) + '…' : title;
}

export function isMissingSessionFile(error: unknown): boolean {
  return asRecord(error)?.code === 'ENOENT';
}

function parseRecord(line: string): JsonRecord | null {
  try {
    const value: unknown = JSON.parse(line);
    return asRecord(value);
  } catch (error) {
    // Live JSONL logs may contain incomplete or malformed individual records.
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function scanSessionLog(
  filePath: string,
  visit: (record: JsonRecord) => boolean,
  maxRecords = Infinity,
): Promise<number | null> {
  try {
    const fileStat = await stat(filePath);
    await new Promise<void>((resolve, reject) => {
      const input = createReadStream(filePath, { encoding: 'utf8' });
      const lines = createInterface({ input, crlfDelay: Infinity });
      let stopped = false;
      let scanned = 0;
      let failure: unknown;

      function stop() {
        if (stopped) return;
        stopped = true;
        lines.close();
        input.destroy();
      }

      function fail(error: unknown) {
        failure ??= error;
        stop();
      }

      input.on('error', fail);
      lines.on('error', fail);
      lines.once('close', stop);
      // Closing readline only pauses its input; wait for the file descriptor to close too.
      input.once('close', () => {
        if (!stopped) {
          fail(new Error(`Session log closed before reading completed: ${filePath}`));
        }
        if (failure !== undefined) reject(failure);
        else resolve();
      });
      lines.on('line', (line: string) => {
        if (stopped || !line.trim()) return;
        scanned++;
        try {
          const record = parseRecord(line);
          if ((record && visit(record)) || scanned >= maxRecords) stop();
        } catch (error) {
          fail(error);
        }
      });
    });
    return Number.isFinite(fileStat.mtimeMs) ? fileStat.mtimeMs : 0;
  } catch (error) {
    if (isMissingSessionFile(error)) return null;
    throw error;
  }
}

function claudeTitle(content: unknown): string {
  if (typeof content === 'string') return trimTitle(content);
  if (Array.isArray(content)) {
    for (const value of content) {
      const part = asRecord(value);
      if (part?.type === 'text' && typeof part.text === 'string') return trimTitle(part.text);
    }
  }
  return '(empty)';
}

/** Missing logs return null; other I/O failures reject. Unknown dates use the log's mtime. */
export async function readClaudeSessionMeta(filePath: string): Promise<ClaudeSessionMeta | null> {
  const meta: Omit<ClaudeSessionMeta, 'timestamp'> & { timestamp: number | null } = {
    title: '(no user message)',
    timestamp: null,
    cwd: null,
    gitBranch: null,
    version: null,
  };
  const mtime = await scanSessionLog(filePath, (record) => {
    if (record.type !== 'user' || record.isSidechain) return false;
    meta.title = claudeTitle(asRecord(record.message)?.content);
    meta.timestamp = timestamp(record.timestamp);
    meta.cwd = asString(record.cwd);
    meta.gitBranch = asString(record.gitBranch);
    meta.version = asString(record.version);
    return true;
  });
  return mtime === null ? null : { ...meta, timestamp: meta.timestamp ?? mtime };
}

interface CopilotHeader {
  sessionId: string | null;
  projectPath: string;
  startTime: number | null;
  cwd: string | null;
  gitBranch: string | null;
  version: string | null;
}

function copilotHeader(record: JsonRecord): CopilotHeader | null {
  if (record.type !== 'session.start') return null;
  const data = asRecord(record.data);
  const context = asRecord(data?.context);
  const projectPath = asString(context?.gitRoot) || asString(context?.cwd);
  if (!projectPath) return null;
  return {
    sessionId: asString(data?.sessionId),
    projectPath: normalize(projectPath),
    startTime: timestamp(data?.startTime),
    cwd: asString(context?.cwd),
    gitBranch: asString(context?.branch),
    version: asString(data?.copilotVersion),
  };
}

/** Missing or headerless logs return null; other I/O failures reject. */
export async function readCopilotSessionMeta(filePath: string): Promise<CopilotSessionMeta | null> {
  const state: {
    header: CopilotHeader | null;
    title: string | null;
    userTimestamp: number | null;
  } = { header: null, title: null, userTimestamp: null };
  const mtime = await scanSessionLog(filePath, (record) => {
    if (!state.header && record.type === 'session.start') {
      state.header = copilotHeader(record);
    } else if (!state.title && record.type === 'user.message') {
      const text = asString(asRecord(record.data)?.content);
      if (text?.trim()) {
        state.title = trimTitle(text);
        state.userTimestamp = timestamp(record.timestamp);
      }
    }
    return state.header !== null && state.title !== null;
  });
  const { header } = state;
  if (mtime === null || !header) return null;
  return {
    sessionId: header.sessionId,
    projectPath: header.projectPath,
    title: state.title ?? '(no user message)',
    timestamp: state.userTimestamp ?? header.startTime ?? mtime,
    cwd: header.cwd,
    gitBranch: header.gitBranch,
    version: header.version,
  };
}

/** Project discovery probes at most twenty nonblank records, without waiting for a user message. */
export async function readCopilotSessionStart(
  filePath: string,
): Promise<CopilotSessionStartMeta | null> {
  const state: { header: CopilotHeader | null } = { header: null };
  const mtime = await scanSessionLog(
    filePath,
    (record) => {
      state.header = copilotHeader(record);
      return state.header !== null;
    },
    20,
  );
  const { header } = state;
  if (mtime === null || !header) return null;
  return {
    sessionId: header.sessionId,
    projectPath: header.projectPath,
    timestamp: header.startTime ?? mtime,
  };
}

/** Missing or headerless logs return null; other I/O failures reject. */
export async function readGeminiSessionMeta(filePath: string): Promise<GeminiSessionMeta | null> {
  const state: {
    header: { sessionId: string; startTime: number | null } | null;
    title: string | null;
  } = { header: null, title: null };
  const mtime = await scanSessionLog(filePath, (record) => {
    const sessionId = asString(record.sessionId);
    if (!state.header && sessionId) {
      state.header = { sessionId, startTime: timestamp(record.startTime) };
    } else if (!state.title && record.type === 'user' && Array.isArray(record.content)) {
      for (const part of record.content) {
        const text = asString(asRecord(part)?.text);
        if (text?.trim()) {
          state.title = trimTitle(text);
          break;
        }
      }
    }
    return state.header !== null && state.title !== null;
  });
  const { header } = state;
  if (mtime === null || !header) return null;
  return {
    sessionId: header.sessionId,
    title: state.title ?? '(no user message)',
    timestamp: header.startTime ?? mtime,
  };
}
