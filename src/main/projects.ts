import { readdir, stat, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig, forgetProject } from './config';
import type { Project, AgentId } from '../shared/types';

const CLAUDE_ROOT = join(homedir(), '.claude', 'projects');
const GEMINI_TMP_ROOT = join(homedir(), '.gemini', 'tmp');

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

export async function listProjects(): Promise<Project[]> {
  const cfg = await loadConfig();
  const pinned = new Set(cfg.pinned);
  const hidden = new Set(cfg.hidden);

  const [claude, gemini] = await Promise.all([
    listClaudeProjects(pinned, hidden),
    listGeminiProjects(pinned, hidden),
  ]);

  const out = [...claude, ...gemini];
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

export async function deleteProject(projectId: string): Promise<void> {
  const colon = projectId.indexOf(':');
  if (colon < 0) throw new Error(`Invalid projectId: ${projectId}`);
  const agent = projectId.slice(0, colon) as AgentId;
  const dirName = projectId.slice(colon + 1);

  if (agent === 'claude') {
    await rm(join(CLAUDE_ROOT, dirName), { recursive: true, force: true });
  } else if (agent === 'gemini') {
    await rm(join(GEMINI_TMP_ROOT, dirName), { recursive: true, force: true });
  } else {
    throw new Error(`Delete not supported for agent: ${agent}`);
  }

  await forgetProject(projectId);
}
