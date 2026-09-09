import { createReadStream } from 'fs';
import { readdir, stat, readFile, rm } from 'fs/promises';
import { createInterface } from 'readline';
import { join, normalize } from 'path';
import { homedir } from 'os';
import { loadConfig, forgetProject } from './config';
import {
  deleteCodexProject,
  groupCodexSessionsByProject,
  listCodexSessions,
} from './codex-storage';
import {
  removeProjectsFromSnapshot,
  stabilizeCopilotProjects,
  validateMissingProjectIds,
  type CopilotScanResult,
} from './project-policies';
import type { Project, AgentId } from '../shared/types';

const CLAUDE_ROOT = join(homedir(), '.claude', 'projects');
const GEMINI_TMP_ROOT = join(homedir(), '.gemini', 'tmp');
const COPILOT_SESSION_STATE_ROOT = join(homedir(), '.copilot', 'session-state');
let lastSuccessfulCopilotProjects: Project[] = [];

// C--jelllove-ParallelAgents   →  C:\jelllove\ParallelAgents
// c--Users-jelllove            →  c:\Users\jelllove
// Naive fallback: every `-` becomes `\`. Loses real `.` in folder names
// (Claude encodes `.` as `-` too — so `Mr.Translator` becomes `Mr-Translator`).
// Prefer `decodeDirNameFromJsonl` below when possible.
export function decodeDirName(name: string): string {
  const m = name.match(/^([a-zA-Z])--(.*)$/);
  if (!m) return name.replaceAll('-', '\\');
  const drive = m[1];
  const rest = m[2].replaceAll('-', '\\');
  return `${drive}:\\${rest}`;
}

// Claude logs the real `cwd` in every jsonl line. Read the first line of any
// session file in `projectDir` and return that as ground truth.
async function decodeDirNameFromJsonl(projectDir: string): Promise<string | null> {
  let files: string[];
  try {
    files = await readdir(projectDir);
  } catch {
    return null;
  }
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    try {
      const content = await readFile(join(projectDir, f), 'utf-8');
      const nl = content.indexOf('\n');
      const firstLine = nl >= 0 ? content.slice(0, nl) : content;
      if (!firstLine.trim()) continue;
      const obj = JSON.parse(firstLine);
      if (typeof obj?.cwd === 'string' && obj.cwd) return obj.cwd;
      // Some early lines (e.g. permission-mode) lack cwd. Probe a few more.
      for (const line of content.split('\n').slice(0, 20)) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line);
          if (typeof o?.cwd === 'string' && o.cwd) return o.cwd;
        } catch {}
      }
    } catch {}
  }
  return null;
}

export function displayNameFor(realPath: string): string {
  const parts = realPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || realPath;
}

export function makeProjectId(agent: AgentId, dirName: string): string {
  return `${agent}:${dirName}`;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

function normalizeProjectPath(p: string): string {
  const n = normalize(p);
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

interface CopilotSessionStartMeta {
  sessionId: string | null;
  projectPath: string;
  timestamp: number;
}

async function readCopilotSessionStart(eventsPath: string): Promise<CopilotSessionStartMeta | null> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: createReadStream(eventsPath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });
    let done = false;
    let scanned = 0;
    rl.on('line', (line) => {
      if (done || !line.trim()) return;
      scanned++;
      let rec: any;
      try {
        rec = JSON.parse(line);
      } catch {
        if (scanned >= 20) {
          done = true;
          rl.close();
          resolve(null);
        }
        return;
      }
      if (rec?.type !== 'session.start') {
        if (scanned >= 20) {
          done = true;
          rl.close();
          resolve(null);
        }
        return;
      }
      const ctx = rec?.data?.context;
      const rawProjectPath = typeof ctx?.gitRoot === 'string' && ctx.gitRoot
        ? ctx.gitRoot
        : (typeof ctx?.cwd === 'string' && ctx.cwd ? ctx.cwd : null);
      if (!rawProjectPath) {
        done = true;
        rl.close();
        resolve(null);
        return;
      }
      const rawTs = typeof rec?.data?.startTime === 'string'
        ? Date.parse(rec.data.startTime)
        : NaN;
      done = true;
      rl.close();
      resolve({
        sessionId: typeof rec?.data?.sessionId === 'string' ? rec.data.sessionId : null,
        projectPath: normalize(rawProjectPath),
        timestamp: Number.isFinite(rawTs) ? rawTs : 0,
      });
    });
    rl.on('close', () => {
      if (!done) resolve(null);
    });
    rl.on('error', () => resolve(null));
  });
}

async function listClaudeProjects(pinned: Set<string>, hidden: Set<string>): Promise<Project[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(CLAUDE_ROOT);
  } catch {
    return [];
  }

  const out: Project[] = [];
  for (const dirName of entries) {
    const full = join(CLAUDE_ROOT, dirName);
    try {
      if (!(await stat(full)).isDirectory()) continue;
    } catch {
      continue;
    }

    const realPath = (await decodeDirNameFromJsonl(full)) ?? decodeDirName(dirName);
    const exists = await pathExists(realPath);
    const id = makeProjectId('claude', dirName);

    let sessionCount = 0;
    let lastActivity: number | null = null;
    try {
      const files = await readdir(full);
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        sessionCount++;
        try {
          const s = await stat(join(full, f));
          if (lastActivity === null || s.mtimeMs > lastActivity) lastActivity = s.mtimeMs;
        } catch {}
      }
    } catch {}

    out.push({
      id,
      agent: 'claude',
      dirName,
      realPath,
      displayName: displayNameFor(realPath),
      exists,
      pinned: pinned.has(id),
      hidden: hidden.has(id),
      sessionCount,
      lastActivity,
    });
  }
  return out;
}

async function listGeminiProjects(pinned: Set<string>, hidden: Set<string>): Promise<Project[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(GEMINI_TMP_ROOT);
  } catch {
    return [];
  }

  const out: Project[] = [];
  for (const dirName of entries) {
    const full = join(GEMINI_TMP_ROOT, dirName);
    try {
      if (!(await stat(full)).isDirectory()) continue;
    } catch {
      continue;
    }

    let realPath = '';
    try {
      realPath = (await readFile(join(full, '.project_root'), 'utf-8')).trim();
    } catch {
      continue; // no .project_root → not a usable Gemini project
    }
    if (!realPath) continue;

    const exists = await pathExists(realPath);
    const id = makeProjectId('gemini', dirName);

    let sessionCount = 0;
    let lastActivity: number | null = null;
    try {
      const chatFiles = await readdir(join(full, 'chats'));
      for (const f of chatFiles) {
        if (!f.endsWith('.jsonl')) continue;
        sessionCount++;
        try {
          const s = await stat(join(full, 'chats', f));
          if (lastActivity === null || s.mtimeMs > lastActivity) lastActivity = s.mtimeMs;
        } catch {}
      }
    } catch {}

    out.push({
      id,
      agent: 'gemini',
      dirName,
      realPath,
      displayName: displayNameFor(realPath),
      exists,
      pinned: pinned.has(id),
      hidden: hidden.has(id),
      sessionCount,
      lastActivity,
    });
  }
  return out;
}

async function listCopilotProjects(
  pinned: Set<string>,
  hidden: Set<string>,
): Promise<CopilotScanResult> {
  let entries: string[] = [];
  try {
    entries = await readdir(COPILOT_SESSION_STATE_ROOT);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return { projects: [], valid: missing, candidateCount: 0, parsedCount: 0 };
  }
  let candidateCount = 0;
  let parsedCount = 0;

  const grouped = new Map<string, {
    realPath: string;
    sessionCount: number;
    lastActivity: number | null;
  }>();

  for (const dirName of entries) {
    const sessionDir = join(COPILOT_SESSION_STATE_ROOT, dirName);
    try {
      if (!(await stat(sessionDir)).isDirectory()) continue;
    } catch {
      continue;
    }

    const eventsPath = join(sessionDir, 'events.jsonl');
    let mtimeMs: number;
    try {
      const s = await stat(eventsPath);
      if (!s.isFile()) continue;
      mtimeMs = s.mtimeMs;
    } catch {
      continue;
    }
    candidateCount++;

    const meta = await readCopilotSessionStart(eventsPath);
    if (!meta) continue;
    parsedCount++;

    const key = normalizeProjectPath(meta.projectPath);
    const existing = grouped.get(key);
    const activityTs = Number.isFinite(mtimeMs) ? mtimeMs : meta.timestamp;
    if (!existing) {
      grouped.set(key, {
        realPath: meta.projectPath,
        sessionCount: 1,
        lastActivity: activityTs || null,
      });
      continue;
    }

    existing.sessionCount += 1;
    if (activityTs && (existing.lastActivity === null || activityTs > existing.lastActivity)) {
      existing.lastActivity = activityTs;
    }
  }

  const out: Project[] = [];
  for (const agg of grouped.values()) {
    const dirName = agg.realPath;
    const id = makeProjectId('copilot', dirName);
    out.push({
      id,
      agent: 'copilot',
      dirName,
      realPath: agg.realPath,
      displayName: displayNameFor(agg.realPath),
      exists: await pathExists(agg.realPath),
      pinned: pinned.has(id),
      hidden: hidden.has(id),
      sessionCount: agg.sessionCount,
      lastActivity: agg.lastActivity,
    });
  }
  return { projects: out, valid: true, candidateCount, parsedCount };
}

async function listCodexProjects(pinned: Set<string>, hidden: Set<string>): Promise<Project[]> {
  const groups = groupCodexSessionsByProject(await listCodexSessions());
  return Promise.all(groups.map(async (group) => {
    const id = makeProjectId('codex', group.realPath);
    return {
      id,
      agent: 'codex',
      dirName: group.realPath,
      realPath: group.realPath,
      displayName: displayNameFor(group.realPath),
      exists: await pathExists(group.realPath),
      pinned: pinned.has(id),
      hidden: hidden.has(id),
      sessionCount: group.sessionCount,
      lastActivity: group.lastActivity,
    };
  }));
}

export async function listProjects(): Promise<Project[]> {
  const cfg = await loadConfig();
  const pinned = new Set(cfg.pinned);
  const hidden = new Set(cfg.hidden);

  const [claude, codex, gemini, copilotScan] = await Promise.all([
    listClaudeProjects(pinned, hidden),
    listCodexProjects(pinned, hidden),
    listGeminiProjects(pinned, hidden),
    listCopilotProjects(pinned, hidden),
  ]);
  const stabilizedCopilot = stabilizeCopilotProjects(lastSuccessfulCopilotProjects, copilotScan);
  if (copilotScan.valid && (copilotScan.candidateCount === 0 || copilotScan.parsedCount > 0)) {
    lastSuccessfulCopilotProjects = stabilizedCopilot;
  }
  const copilot = stabilizedCopilot.map((project) => ({
    ...project,
    pinned: pinned.has(project.id),
    hidden: hidden.has(project.id),
  }));

  const out = [...claude, ...codex, ...gemini, ...copilot];
  const orderIndex = (p: Project): number => {
    const ids = cfg.projectOrder?.[p.agent] ?? [];
    const i = ids.indexOf(p.id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  out.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.agent === b.agent) {
      const ai = orderIndex(a);
      const bi = orderIndex(b);
      if (ai !== bi) return ai - bi;
    }
    return (b.lastActivity ?? 0) - (a.lastActivity ?? 0);
  });
  return out;
}

async function deleteProjectHistory(projectId: string): Promise<void> {
  const colon = projectId.indexOf(':');
  if (colon < 0) throw new Error(`Invalid projectId: ${projectId}`);
  const agent = projectId.slice(0, colon) as AgentId;
  const dirName = projectId.slice(colon + 1);

  if (agent === 'claude') {
    await rm(join(CLAUDE_ROOT, dirName), { recursive: true, force: true });
  } else if (agent === 'codex') {
    await deleteCodexProject(dirName);
  } else if (agent === 'gemini') {
    await rm(join(GEMINI_TMP_ROOT, dirName), { recursive: true, force: true });
  } else if (agent === 'copilot') {
    const target = normalizeProjectPath(dirName);
    let entries: string[] = [];
    try {
      entries = await readdir(COPILOT_SESSION_STATE_ROOT);
    } catch {
      entries = [];
    }
    for (const sessionDirName of entries) {
      const sessionDir = join(COPILOT_SESSION_STATE_ROOT, sessionDirName);
      const eventsPath = join(sessionDir, 'events.jsonl');
      const meta = await readCopilotSessionStart(eventsPath);
      if (!meta) continue;
      if (normalizeProjectPath(meta.projectPath) !== target) continue;
      await rm(sessionDir, { recursive: true, force: true });
    }
  } else {
    throw new Error(`Delete not supported for agent: ${agent}`);
  }
}

export async function deleteProject(projectId: string): Promise<void> {
  await deleteProjectHistory(projectId);
  lastSuccessfulCopilotProjects = removeProjectsFromSnapshot(
    lastSuccessfulCopilotProjects,
    [projectId],
  );
  await forgetProject(projectId);
}

export async function deleteMissingProjects(projectIds: string[]): Promise<void> {
  if (projectIds.length === 0) throw new Error('No projects selected');
  const targets = validateMissingProjectIds(await listProjects(), projectIds);
  for (const project of targets) {
    if (await pathExists(project.realPath)) {
      throw new Error(`Project is not missing: ${project.id}`);
    }
  }
  for (const project of targets) {
    await deleteProjectHistory(project.id);
    lastSuccessfulCopilotProjects = removeProjectsFromSnapshot(
      lastSuccessfulCopilotProjects,
      [project.id],
    );
    await forgetProject(project.id);
  }
}
