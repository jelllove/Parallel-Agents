import { readdir, stat, createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import { promisify } from 'util';
import { createInterface } from 'readline';
import { join } from 'path';
import { homedir } from 'os';
import type { Session, AgentId } from '../shared/types';

const readdirP = promisify(readdir);
const statP = promisify(stat);

const CLAUDE_ROOT = join(homedir(), '.claude', 'projects');
const GEMINI_TMP_ROOT = join(homedir(), '.gemini', 'tmp');

const TITLE_MAX = 80;

function trimTitle(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX) + '…' : t;
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

export async function listSessionsForProject(projectId: string): Promise<Session[]> {
  const colon = projectId.indexOf(':');
  if (colon < 0) return [];
  const agent = projectId.slice(0, colon) as AgentId;
  const dirName = projectId.slice(colon + 1);

  let out: Session[] = [];
  if (agent === 'claude') out = await listClaudeSessions(projectId, dirName);
  else if (agent === 'gemini') out = await listGeminiSessions(projectId, dirName);
  // codex/aider/copilot: no session listing in v1

  out.sort((a, b) => b.timestamp - a.timestamp);
  return out;
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
  const colon = projectId.indexOf(':');
  if (colon < 0) throw new Error(`Invalid projectId: ${projectId}`);
  const agent = projectId.slice(0, colon) as AgentId;
  const dirName = projectId.slice(colon + 1);

  if (agent === 'claude') {
    await unlink(join(CLAUDE_ROOT, dirName, `${sessionId}.jsonl`));
  } else if (agent === 'gemini') {
    const file = await findGeminiSessionFile(dirName, sessionId);
    if (!file) throw new Error(`Session not found: ${sessionId}`);
    await unlink(file);
  } else {
    throw new Error(`Delete not supported for agent: ${agent}`);
  }
}
