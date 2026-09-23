import { readdir, stat, unlink, rm } from 'fs/promises';
import { join, normalize } from 'path';
import { homedir } from 'os';
import {
  deleteCodexProjectSession,
  filterCodexSessionsByProject,
  listCodexSessions,
} from './codex-storage.ts';
import type { Session, AgentId } from '../shared/types.ts';
import {
  isMissingSessionFile,
  readClaudeSessionMeta,
  readCopilotSessionMeta,
  readGeminiSessionMeta,
} from './session-metadata.ts';
import { preferences } from './preferences-store.ts';
import { applySessionNames } from '../shared/session-presentation.ts';
import { worktreeMembersOf } from './worktree-members.ts';

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

async function worktreeMembers(projectId: string) {
  const members = worktreeMembersOf(projectId);
  return members && members.length > 1 ? members : null;
}

export async function listSessionsForProject(projectId: string): Promise<Session[]> {
  const members = await worktreeMembers(projectId);
  if (!members) return listFolderSessions(projectId);
  const lists = await Promise.all(
    members.map(async (member) =>
      (await listFolderSessions(member.id)).map((s) => ({
        ...s,
        projectId,
        cwd: s.cwd ?? member.realPath,
        historyProjectId: member.id,
      })),
    ),
  );
  return lists.flat().sort((a, b) => b.timestamp - a.timestamp);
}

async function sessionOwner(projectId: string, sessionId: string): Promise<string> {
  const members = await worktreeMembers(projectId);
  if (!members) return projectId;
  for (const member of members) {
    if ((await listFolderSessions(member.id)).some((s) => s.id === sessionId)) return member.id;
  }
  throw new Error(`Session not found: ${sessionId}`);
}

async function modifiedAt(filePath: string): Promise<number | undefined> {
  try {
    return (await stat(filePath)).mtimeMs;
  } catch {
    return undefined;
  }
}

async function readSessionDirectory(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (isMissingSessionFile(error)) return [];
    throw error;
  }
}

async function listClaudeSessions(projectId: string, dirName: string): Promise<Session[]> {
  const dir = join(CLAUDE_ROOT, dirName);
  const files = await readSessionDirectory(dir);
  const out: Session[] = [];
  for (const f of files.filter((x) => x.endsWith('.jsonl'))) {
    const full = join(dir, f);
    const id = f.replace(/\.jsonl$/, '');
    const meta = await readClaudeSessionMeta(full);
    if (!meta) continue;
    out.push({
      id,
      projectId,
      agent: 'claude',
      ...meta,
      modifiedAt: await modifiedAt(full),
    });
  }
  return out;
}

async function listGeminiSessions(projectId: string, dirName: string): Promise<Session[]> {
  const chatsDir = join(GEMINI_TMP_ROOT, dirName, 'chats');
  const files = await readSessionDirectory(chatsDir);
  const out: Session[] = [];
  for (const f of files.filter((x) => x.endsWith('.jsonl'))) {
    const full = join(chatsDir, f);
    const meta = await readGeminiSessionMeta(full);
    if (!meta?.sessionId) continue;
    out.push({
      id: meta.sessionId,
      projectId,
      agent: 'gemini',
      title: meta.title,
      timestamp: meta.timestamp,
      modifiedAt: await modifiedAt(full),
      cwd: null,
      gitBranch: null,
      version: null,
    });
  }
  return out;
}

async function listCopilotSessions(projectId: string, projectPath: string): Promise<Session[]> {
  const entries = await readSessionDirectory(COPILOT_SESSION_STATE_ROOT);
  const targetPath = normalizeProjectPath(projectPath);
  const out: Session[] = [];
  for (const dirName of entries) {
    const sessionDir = join(COPILOT_SESSION_STATE_ROOT, dirName);
    try {
      if (!(await stat(sessionDir)).isDirectory()) continue;
    } catch (error) {
      if (isMissingSessionFile(error)) continue;
      throw error;
    }

    const eventsPath = join(sessionDir, 'events.jsonl');
    const meta = await readCopilotSessionMeta(eventsPath);
    if (!meta) continue;
    if (normalizeProjectPath(meta.projectPath) !== targetPath) continue;
    out.push({
      id: meta.sessionId ?? dirName,
      projectId,
      agent: 'copilot',
      title: meta.title,
      timestamp: meta.timestamp,
      modifiedAt: await modifiedAt(eventsPath),
      cwd: meta.cwd,
      gitBranch: meta.gitBranch,
      version: meta.version,
    });
  }
  return out;
}

async function listFolderSessions(projectId: string): Promise<Session[]> {
  const historyId = await resolveHistoryProjectId(projectId);
  if (!historyId) return [];
  if (historyId !== projectId) {
    return (await listFolderSessions(historyId)).map((s) => ({ ...s, projectId }));
  }
  const colon = projectId.indexOf(':');
  if (colon < 0) return [];
  const agent = projectId.slice(0, colon) as AgentId;
  const dirName = projectId.slice(colon + 1);

  let out: Session[] = [];
  if (agent === 'claude') out = await listClaudeSessions(projectId, dirName);
  else if (agent === 'codex') {
    const codexSessions = filterCodexSessionsByProject(await listCodexSessions(), dirName);
    out = await Promise.all(
      codexSessions.map(async (session) => ({
        id: session.id,
        projectId,
        agent: 'codex' as const,
        title: session.title,
        timestamp: session.timestamp,
        modifiedAt: await modifiedAt(session.filePath),
        cwd: session.cwd,
        gitBranch: null,
        version: session.version,
      })),
    );
  } else if (agent === 'gemini') out = await listGeminiSessions(projectId, dirName);
  else if (agent === 'copilot') out = await listCopilotSessions(projectId, dirName);
  // aider: no session listing in v1

  out.sort((a, b) => b.timestamp - a.timestamp);
  return applySessionNames(out, (await preferences.read()).sessionNames);
}

export async function renameSession(
  projectId: string,
  sessionId: string,
  title: string,
): Promise<string> {
  const session = (await listSessionsForProject(projectId)).find((s) => s.id === sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  return preferences.renameSession(session.agent, session.id, title);
}

async function findGeminiSessionFile(dirName: string, sessionId: string): Promise<string | null> {
  const chatsDir = join(GEMINI_TMP_ROOT, dirName, 'chats');
  const files = await readSessionDirectory(chatsDir);
  for (const f of files.filter((x) => x.endsWith('.jsonl'))) {
    const full = join(chatsDir, f);
    const meta = await readGeminiSessionMeta(full);
    if (meta?.sessionId === sessionId) return full;
  }
  return null;
}

export async function deleteSession(projectId: string, sessionId: string): Promise<void> {
  const owner = await sessionOwner(projectId, sessionId);
  if (owner !== projectId) return deleteFolderSession(owner, sessionId);
  return deleteFolderSession(projectId, sessionId);
}

async function deleteFolderSession(projectId: string, sessionId: string): Promise<void> {
  const historyId = await resolveHistoryProjectId(projectId);
  if (!historyId) throw new Error(`Session not found: ${sessionId}`);
  if (historyId !== projectId) return deleteFolderSession(historyId, sessionId);
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
