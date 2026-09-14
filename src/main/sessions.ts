import { readdir, stat, createReadStream } from 'fs';
import { unlink, rm } from 'fs/promises';
import { promisify } from 'util';
import { createInterface } from 'readline';
import { join, normalize } from 'path';
import { homedir } from 'os';
import {
  deleteCodexSession,
  filterCodexSessionsByProject,
  listCodexSessions,
} from './codex-storage';
import type { Session, AgentId } from '../shared/types';
import { preferences } from './preferences-store';
import { applySessionNames } from '../shared/session-presentation';
import { resolveHistoryProjectId } from './projects';

const readdirP = promisify(readdir);
const statP = promisify(stat);

const CLAUDE_ROOT = join(homedir(), '.claude', 'projects');
const GEMINI_TMP_ROOT = join(homedir(), '.gemini', 'tmp');
const COPILOT_SESSION_STATE_ROOT = join(homedir(), '.copilot', 'session-state');

const TITLE_MAX = 80;

function trimTitle(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX) + '…' : t;
}

function normalizeProjectPath(p: string): string {
  const n = normalize(p);
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

interface CopilotSessionMeta {
  sessionId: string | null;
  projectPath: string;
  title: string;
  timestamp: number;
  cwd: string | null;
  gitBranch: string | null;
  version: string | null;
}

async function readCopilotSessionMeta(filePath: string): Promise<CopilotSessionMeta | null> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });
    let header: {
      sessionId: string | null;
      projectPath: string;
      startTime: number;
      cwd: string | null;
      gitBranch: string | null;
      version: string | null;
    } | null = null;
    let title: string | null = null;
    let userTs: number | null = null;
    rl.on('line', (line) => {
      if (!line) return;
      let rec: any;
      try {
        rec = JSON.parse(line);
      } catch {
        return;
      }
      if (!header && rec?.type === 'session.start') {
        const ctx = rec?.data?.context;
        const rawProjectPath = typeof ctx?.gitRoot === 'string' && ctx.gitRoot
          ? ctx.gitRoot
          : (typeof ctx?.cwd === 'string' && ctx.cwd ? ctx.cwd : null);
        if (!rawProjectPath) return;
        const rawStartTs = typeof rec?.data?.startTime === 'string'
          ? Date.parse(rec.data.startTime)
          : NaN;
        header = {
          sessionId: typeof rec?.data?.sessionId === 'string' ? rec.data.sessionId : null,
          projectPath: normalize(rawProjectPath),
          startTime: Number.isFinite(rawStartTs) ? rawStartTs : Date.now(),
          cwd: typeof ctx?.cwd === 'string' ? ctx.cwd : null,
          gitBranch: typeof ctx?.branch === 'string' ? ctx.branch : null,
          version: typeof rec?.data?.copilotVersion === 'string' ? rec.data.copilotVersion : null,
        };
      } else if (!title && rec?.type === 'user.message') {
        const text = typeof rec?.data?.content === 'string' ? rec.data.content : '';
        if (text.trim()) {
          title = trimTitle(text);
          const rawUserTs = typeof rec?.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
          if (Number.isFinite(rawUserTs)) userTs = rawUserTs;
        }
      }
      if (header && title) rl.close();
    });
    rl.on('close', () => {
      if (!header) {
        resolve(null);
        return;
      }
      resolve({
        sessionId: header.sessionId,
        projectPath: header.projectPath,
        title: title ?? '(no user message)',
        timestamp: userTs ?? header.startTime,
        cwd: header.cwd,
        gitBranch: header.gitBranch,
        version: header.version,
      });
    });
    rl.on('error', () => resolve(null));
  });
}

function extractTitleFromClaude(content: unknown): string {
  if (typeof content === 'string') return trimTitle(content);
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === 'object' && 'type' in part && (part as any).type === 'text') {
        return extractTitleFromClaude((part as any).text);
      }
    }
  }
  return '(empty)';
}

async function readFirstClaudeUserMessage(filePath: string): Promise<{
  title: string;
  timestamp: number;
  cwd: string | null;
  gitBranch: string | null;
  version: string | null;
} | null> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });
    let done = false;
    rl.on('line', (line) => {
      if (done || !line) return;
      let rec: any;
      try {
        rec = JSON.parse(line);
      } catch {
        return;
      }
      if (rec.type !== 'user' || rec.isSidechain) return;
      done = true;
      rl.close();
      resolve({
        title: extractTitleFromClaude(rec.message?.content),
        timestamp: rec.timestamp ? Date.parse(rec.timestamp) : Date.now(),
        cwd: rec.cwd ?? null,
        gitBranch: rec.gitBranch ?? null,
        version: rec.version ?? null,
      });
    });
    rl.on('close', () => {
      if (!done) resolve(null);
    });
    rl.on('error', () => resolve(null));
  });
}

async function readGeminiSessionMeta(filePath: string): Promise<{
  sessionId: string | null;
  title: string;
  timestamp: number;
} | null> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });
    let header: { sessionId?: string; startTime?: string } | null = null;
    let title: string | null = null;
    rl.on('line', (line) => {
      if (!line) return;
      let rec: any;
      try {
        rec = JSON.parse(line);
      } catch {
        return;
      }
      if (!header && rec.sessionId) {
        header = rec;
      } else if (!title && rec.type === 'user') {
        const text =
          (Array.isArray(rec.content) && rec.content.find((c: any) => c?.text)?.text) || '';
        if (text) title = trimTitle(text);
      }
      if (header && title) {
        rl.close();
      }
    });
    rl.on('close', () => {
      if (!header) {
        resolve(null);
        return;
      }
      resolve({
        sessionId: header.sessionId ?? null,
        title: title ?? '(no user message)',
        timestamp: header.startTime ? Date.parse(header.startTime) : Date.now(),
      });
    });
    rl.on('error', () => resolve(null));
  });
}

async function listClaudeSessions(projectId: string, dirName: string): Promise<Session[]> {
  const dir = join(CLAUDE_ROOT, dirName);
  let files: string[];
  try {
    files = await readdirP(dir);
  } catch {
    return [];
  }
  const out: Session[] = [];
  for (const f of files.filter((x) => x.endsWith('.jsonl'))) {
    const full = join(dir, f);
    const id = f.replace(/\.jsonl$/, '');
    let mtime = 0;
    try {
      mtime = (await statP(full)).mtimeMs;
    } catch {}
    const meta = await readFirstClaudeUserMessage(full);
    out.push({
      id,
      projectId,
      agent: 'claude',
      title: meta?.title ?? '(no user message)',
      timestamp: meta?.timestamp ?? mtime,
      cwd: meta?.cwd ?? null,
      gitBranch: meta?.gitBranch ?? null,
      version: meta?.version ?? null,
    });
  }
  return out;
}

async function listGeminiSessions(projectId: string, dirName: string): Promise<Session[]> {
  const chatsDir = join(GEMINI_TMP_ROOT, dirName, 'chats');
  let files: string[];
  try {
    files = await readdirP(chatsDir);
  } catch {
    return [];
  }
  const out: Session[] = [];
  for (const f of files.filter((x) => x.endsWith('.jsonl'))) {
    const full = join(chatsDir, f);
    let mtime = 0;
    try {
      mtime = (await statP(full)).mtimeMs;
    } catch {}
    const meta = await readGeminiSessionMeta(full);
    if (!meta?.sessionId) continue;
    out.push({
      id: meta.sessionId,
      projectId,
      agent: 'gemini',
      title: meta.title,
      timestamp: meta.timestamp || mtime,
      cwd: null,
      gitBranch: null,
      version: null,
    });
  }
  return out;
}

async function listCopilotSessions(projectId: string, projectPath: string): Promise<Session[]> {
  let entries: string[];
  try {
    entries = await readdirP(COPILOT_SESSION_STATE_ROOT);
  } catch {
    return [];
  }
  const targetPath = normalizeProjectPath(projectPath);
  const out: Session[] = [];
  for (const dirName of entries) {
    const sessionDir = join(COPILOT_SESSION_STATE_ROOT, dirName);
    let isDir = false;
    try {
      isDir = (await statP(sessionDir)).isDirectory();
    } catch {}
    if (!isDir) continue;

    const eventsPath = join(sessionDir, 'events.jsonl');
    let mtime = 0;
    try {
      mtime = (await statP(eventsPath)).mtimeMs;
    } catch {
      continue;
    }

    const meta = await readCopilotSessionMeta(eventsPath);
    if (!meta) continue;
    if (normalizeProjectPath(meta.projectPath) !== targetPath) continue;
    out.push({
      id: meta.sessionId ?? dirName,
      projectId,
      agent: 'copilot',
      title: meta.title,
      timestamp: meta.timestamp || mtime,
      cwd: meta.cwd,
      gitBranch: meta.gitBranch,
      version: meta.version,
    });
  }
  return out;
}

export async function listSessionsForProject(projectId: string): Promise<Session[]> {
  const historyId = await resolveHistoryProjectId(projectId);
  if (!historyId) return [];
  if (historyId !== projectId) {
    return (await listSessionsForProject(historyId)).map((s) => ({ ...s, projectId }));
  }
  const colon = projectId.indexOf(':');
  if (colon < 0) return [];
  const agent = projectId.slice(0, colon) as AgentId;
  const dirName = projectId.slice(colon + 1);

  let out: Session[] = [];
  if (agent === 'claude') out = await listClaudeSessions(projectId, dirName);
  else if (agent === 'codex') {
    out = filterCodexSessionsByProject(await listCodexSessions(), dirName).map((session) => ({
      id: session.id,
      projectId,
      agent: 'codex',
      title: session.title,
      timestamp: session.timestamp,
      cwd: session.cwd,
      gitBranch: null,
      version: session.version,
    }));
  } else if (agent === 'gemini') out = await listGeminiSessions(projectId, dirName);
  else if (agent === 'copilot') out = await listCopilotSessions(projectId, dirName);
  // aider: no session listing in v1

  out.sort((a, b) => b.timestamp - a.timestamp);
  return applySessionNames(out, (await preferences.read()).sessionNames);
}

export async function renameSession(projectId: string, sessionId: string, title: string): Promise<string> {
  const session = (await listSessionsForProject(projectId)).find((s) => s.id === sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  return preferences.renameSession(session.agent, session.id, title);
}

async function findGeminiSessionFile(dirName: string, sessionId: string): Promise<string | null> {
  const chatsDir = join(GEMINI_TMP_ROOT, dirName, 'chats');
  let files: string[];
  try {
    files = await readdirP(chatsDir);
  } catch {
    return null;
  }
  for (const f of files.filter((x) => x.endsWith('.jsonl'))) {
    const full = join(chatsDir, f);
    const meta = await readGeminiSessionMeta(full);
    if (meta?.sessionId === sessionId) return full;
  }
  return null;
}

export async function deleteSession(projectId: string, sessionId: string): Promise<void> {
  const historyId = await resolveHistoryProjectId(projectId);
  if (!historyId) throw new Error(`Session not found: ${sessionId}`);
  if (historyId !== projectId) return deleteSession(historyId, sessionId);
  const colon = projectId.indexOf(':');
  if (colon < 0) throw new Error(`Invalid projectId: ${projectId}`);
  const agent = projectId.slice(0, colon) as AgentId;
  const dirName = projectId.slice(colon + 1);

  if (agent === 'claude') {
    await unlink(join(CLAUDE_ROOT, dirName, `${sessionId}.jsonl`));
  } else if (agent === 'codex') {
    await deleteCodexSession(sessionId);
  } else if (agent === 'gemini') {
    const file = await findGeminiSessionFile(dirName, sessionId);
    if (!file) throw new Error(`Session not found: ${sessionId}`);
    await unlink(file);
  } else if (agent === 'copilot') {
    await rm(join(COPILOT_SESSION_STATE_ROOT, sessionId), { recursive: true, force: true });
  } else {
    throw new Error(`Delete not supported for agent: ${agent}`);
  }
}
