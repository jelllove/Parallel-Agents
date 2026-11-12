import { readdir, stat, unlink, rm } from 'fs/promises';
import { join, normalize } from 'path';
import { homedir } from 'os';
import {
  deleteCodexProjectSession,
  filterCodexSessionsByProject,
  listCodexSessions,
  invalidateCodexMetadata,
} from './codex-storage.ts';
import type { Session, AgentId } from '../shared/types.ts';
import {
  isMissingSessionFile,
  readClaudeSessionMeta,
  readCopilotSessionMeta,
  readGeminiSessionMeta,
  invalidateSessionMetadata,
} from './session-metadata.ts';
import { freshHistoryRead, withFreshHistory, shareHistoryRead } from './history-read-context.ts';
import { preferences } from './preferences-store.ts';
import { applySessionNames } from '../shared/session-presentation.ts';

export function invalidateHistoryMetadata(): void {
  invalidateSessionMetadata();
  invalidateCodexMetadata();
}

const CLAUDE_ROOT = join(homedir(), '.claude', 'projects');
const GEMINI_TMP_ROOT = join(homedir(), '.gemini', 'tmp');
const COPILOT_SESSION_STATE_ROOT = join(homedir(), '.copilot', 'session-state');

function normalizeProjectPath(p: string): string {
  const n = normalize(p);
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

async function resolveHistoryProjectId(projectId: string): Promise<string | null> {
  if (!projectId.includes(':manual:')) return projectId;
  const projects = await import('./projects.ts');
  return projects.resolveHistoryProjectId(projectId);
}

async function readSessionDirectory(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (isMissingSessionFile(error)) return [];
    throw error;
  }
}

async function listClaudeSessions(
  projectId: string,
  dirName: string,
  fresh: boolean,
): Promise<Session[]> {
  const dir = join(CLAUDE_ROOT, dirName);
  const files = await readSessionDirectory(dir);
  const out: Session[] = [];
  for (const f of files.filter((x) => x.endsWith('.jsonl'))) {
    const full = join(dir, f);
    const id = f.replace(/\.jsonl$/, '');
    const meta = await readClaudeSessionMeta(full, fresh);
    if (!meta) continue;
    out.push({
      id,
      projectId,
      agent: 'claude',
      ...meta,
    });
  }
  return out;
}

async function listGeminiSessions(
  projectId: string,
  dirName: string,
  fresh: boolean,
): Promise<Session[]> {
  const chatsDir = join(GEMINI_TMP_ROOT, dirName, 'chats');
  const files = await readSessionDirectory(chatsDir);
  const out: Session[] = [];
  for (const f of files.filter((x) => x.endsWith('.jsonl'))) {
    const full = join(chatsDir, f);
    const meta = await readGeminiSessionMeta(full, fresh);
    if (!meta?.sessionId) continue;
    out.push({
      id: meta.sessionId,
      projectId,
      agent: 'gemini',
      title: meta.title,
      timestamp: meta.timestamp,
      createdAt: meta.createdAt,
      cwd: null,
      gitBranch: null,
      version: null,
    });
  }
  return out;
}

async function listCopilotSessions(
  projectId: string,
  projectPath: string,
  fresh: boolean,
): Promise<Session[]> {
  const entries = await shareHistoryRead(`copilot:${fresh}`, () => readCopilotSessions(fresh));
  return entries
    .filter(
      (session) => normalizeProjectPath(session.cwdProject) === normalizeProjectPath(projectPath),
    )
    .map((session) => ({
      id: session.id,
      projectId,
      agent: session.agent,
      title: session.title,
      timestamp: session.timestamp,
      createdAt: session.createdAt,
      cwd: session.cwd,
      gitBranch: session.gitBranch,
      version: session.version,
    }));
}
async function readCopilotSessions(fresh: boolean) {
  const entries = await readSessionDirectory(COPILOT_SESSION_STATE_ROOT);
  const out: (Omit<Session, 'projectId'> & { cwdProject: string })[] = [];
  for (const dirName of entries) {
    const sessionDir = join(COPILOT_SESSION_STATE_ROOT, dirName);
    try {
      if (!(await stat(sessionDir)).isDirectory()) continue;
    } catch (error) {
      if (isMissingSessionFile(error)) continue;
      throw error;
    }

    const meta = await readCopilotSessionMeta(join(sessionDir, 'events.jsonl'), fresh);
    if (!meta) continue;
    out.push({
      id: meta.sessionId ?? dirName,
      cwdProject: meta.projectPath,
      agent: 'copilot',
      title: meta.title,
      timestamp: meta.timestamp,
      createdAt: meta.createdAt,
      cwd: meta.cwd,
      gitBranch: meta.gitBranch,
      version: meta.version,
    });
  }
  return out;
}

export async function listSessionsForProject(projectId: string, fresh = false): Promise<Session[]> {
  if (fresh && !freshHistoryRead())
    return withFreshHistory(() => listSessionsForProject(projectId, true));
  const historyId = await resolveHistoryProjectId(projectId);
  if (!historyId) return [];
  if (historyId !== projectId) {
    return (await listSessionsForProject(historyId, fresh)).map((s) => ({ ...s, projectId }));
  }
  const colon = projectId.indexOf(':');
  if (colon < 0) return [];
  const agent = projectId.slice(0, colon) as AgentId;
  const dirName = projectId.slice(colon + 1);

  let out: Session[] = [];
  if (agent === 'claude') out = await listClaudeSessions(projectId, dirName, fresh);
  else if (agent === 'codex') {
    out = filterCodexSessionsByProject(await listCodexSessions(undefined, fresh), dirName).map(
      (session) => ({
        id: session.id,
        projectId,
        agent: 'codex',
        title: session.title,
        timestamp: session.timestamp,
        createdAt: session.createdAt,
        cwd: session.cwd,
        gitBranch: null,
        version: session.version,
      }),
    );
  } else if (agent === 'gemini') out = await listGeminiSessions(projectId, dirName, fresh);
  else if (agent === 'copilot') out = await listCopilotSessions(projectId, dirName, fresh);
  // aider: no session listing in v1

  out.sort((a, b) => b.timestamp - a.timestamp);
  const saved = await preferences.read();
  return applySessionNames(out, saved.sessionNames, saved.generatedTitles);
}

export async function renameSession(
  projectId: string,
  sessionId: string,
  title: string,
): Promise<string> {
  const session = (await listSessionsForProject(projectId, true)).find((s) => s.id === sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  return preferences.renameSession(session.agent, session.id, title);
}

async function findGeminiSessionFile(dirName: string, sessionId: string): Promise<string | null> {
  const chatsDir = join(GEMINI_TMP_ROOT, dirName, 'chats');
  const files = await readSessionDirectory(chatsDir);
  for (const f of files.filter((x) => x.endsWith('.jsonl'))) {
    const full = join(chatsDir, f);
    const meta = await readGeminiSessionMeta(full, true);
    if (meta?.sessionId === sessionId) return full;
  }
  return null;
}

export async function deleteSession(projectId: string, sessionId: string): Promise<void> {
  if (!freshHistoryRead()) return withFreshHistory(() => deleteSession(projectId, sessionId));
  invalidateHistoryMetadata();
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
    await deleteCodexProjectSession(dirName, sessionId);
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
