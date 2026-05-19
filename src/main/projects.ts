import { app } from 'electron';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { loadConfig } from './config';
import type { Project } from '../shared/types';

const PROJECTS_ROOT = join(app.getPath('home'), '.claude', 'projects');

// C--XQQ-ClaudeCodeShell  →  C:\XQQ\ClaudeCodeShell
// c--Users-qinqiangxu     →  c:\Users\qinqiangxu
export function decodeDirName(name: string): string {
  const m = name.match(/^([a-zA-Z])--(.*)$/);
  if (!m) return name.replaceAll('-', '\\');
  const drive = m[1];
  const rest = m[2].replaceAll('-', '\\');
  return `${drive}:\\${rest}`;
}

export function displayNameFor(realPath: string): string {
  const parts = realPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || realPath;
}

export async function listProjects(): Promise<Project[]> {
  const cfg = await loadConfig();

  let entries: string[] = [];
  try {
    entries = await readdir(PROJECTS_ROOT);
  } catch {
    return [];
  }

  const out: Project[] = [];
  for (const dirName of entries) {
    const full = join(PROJECTS_ROOT, dirName);
    let isDir = false;
    try {
      isDir = (await stat(full)).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    const realPath = decodeDirName(dirName);
    let exists = false;
    try {
      exists = (await stat(realPath)).isDirectory();
    } catch {
      exists = false;
    }

    let sessionCount = 0;
    let lastActivity: number | null = null;
    try {
      const files = await readdir(full);
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        sessionCount++;
        try {
          const s = await stat(join(full, f));
          const ts = s.mtimeMs;
          if (lastActivity === null || ts > lastActivity) lastActivity = ts;
        } catch {}
      }
    } catch {}

    out.push({
      id: dirName,
      dirName,
      realPath,
      displayName: displayNameFor(realPath),
      exists,
      pinned: cfg.pinned.includes(dirName),
      hidden: cfg.hidden.includes(dirName),
      sessionCount,
      lastActivity,
    });
  }

  out.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.lastActivity ?? 0) - (a.lastActivity ?? 0);
  });

  return out;
}
