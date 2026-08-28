import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { existsSync, FSWatcher, watch as watchSync } from 'fs';
import { join } from 'path';
import { BrowserWindow } from 'electron';
import type { GitStatus, GitChange, GitFileState } from '../shared/types';
import { sendToWindow } from './window-messenger';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

async function git(repoPath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', ['-C', repoPath, ...args], { maxBuffer: 32 * 1024 * 1024 });
}

let gitChecked = false;
let gitAvailable = false;
export async function isGitAvailable(): Promise<boolean> {
  if (gitChecked) return gitAvailable;
  gitChecked = true;
  try {
    await execAsync('git --version');
    gitAvailable = true;
  } catch {
    gitAvailable = false;
  }
  return gitAvailable;
}

async function isRepo(repoPath: string): Promise<boolean> {
  try {
    const { stdout } = await git(repoPath, ['rev-parse', '--is-inside-work-tree']);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

function decodeStatus(c: string): GitFileState | null {
  switch (c) {
    case 'M': return 'modified';
    case 'A': return 'added';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    case 'C': return 'renamed'; // copied — treat as renamed for UI purposes
    case '?': return 'untracked';
    case 'U': return 'conflict';
    case ' ': return null;
    default: return null;
  }
}

function parsePorcelainZ(out: string): GitChange[] {
  // Records are NUL-terminated. R/C records have an extra NUL-separated oldPath field.
  const parts = out.split('\0');
  const changes: GitChange[] = [];
  let i = 0;
  while (i < parts.length) {
    const rec = parts[i];
    if (!rec) { i++; continue; }
    const xy = rec.slice(0, 2);
    const path = rec.slice(3);
    const x = xy[0];
    const y = xy[1];
    let oldPath: string | undefined;
    if (x === 'R' || x === 'C') {
      oldPath = parts[i + 1];
      i += 2;
    } else {
      i += 1;
    }
    if (xy === '??') {
      changes.push({ path, staged: null, unstaged: 'untracked' });
      continue;
    }
    changes.push({
      path,
      staged: decodeStatus(x),
      unstaged: decodeStatus(y),
      oldPath,
    });
  }
  return changes;
}

async function getAheadBehind(repoPath: string): Promise<{ ahead: number; behind: number }> {
  try {
    const { stdout } = await git(repoPath, ['rev-list', '--left-right', '--count', '@{u}...HEAD']);
    const [behind, ahead] = stdout.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0);
    return { ahead: ahead ?? 0, behind: behind ?? 0 };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

export async function getStatus(repoPath: string): Promise<GitStatus | null> {
  if (!(await isGitAvailable())) return null;
  if (!(await isRepo(repoPath))) return null;

  const [{ stdout: branchOut }, { stdout: statusOut }, ab] = await Promise.all([
    git(repoPath, ['branch', '--show-current']),
    git(repoPath, ['status', '--porcelain=v1', '-z', '--untracked-files=normal']),
    getAheadBehind(repoPath),
  ]);
  const branch = branchOut.trim() || '(detached)';
  const changes = parsePorcelainZ(statusOut);
  return { branch, ahead: ab.ahead, behind: ab.behind, changes };
}

export async function getDiff(
  repoPath: string,
  filePath: string,
  staged: boolean,
): Promise<{ oldContent: string; newContent: string; oldLabel: string; newLabel: string }> {
  // For staged: compare HEAD:file vs index:file (git show :file).
  // For working: compare HEAD:file (or index for untracked) vs filesystem.
  let oldContent = '';
  let oldLabel = 'HEAD';
  try {
    const { stdout } = await git(repoPath, ['show', `HEAD:${filePath}`]);
    oldContent = stdout;
  } catch {
    oldContent = '';
    oldLabel = '(new file)';
  }

  let newContent = '';
  let newLabel = staged ? 'index' : 'working tree';
  if (staged) {
    try {
      const { stdout } = await git(repoPath, ['show', `:${filePath}`]);
      newContent = stdout;
    } catch {
      newContent = '';
    }
  } else {
    try {
      newContent = await readFile(join(repoPath, filePath), 'utf-8');
    } catch {
      newContent = '';
      newLabel = '(deleted)';
    }
  }
  return { oldContent, newContent, oldLabel, newLabel };
}

export async function stage(repoPath: string, files: string[]): Promise<void> {
  if (!files.length) return;
  await git(repoPath, ['add', '--', ...files]);
}

export async function unstage(repoPath: string, files: string[]): Promise<void> {
  if (!files.length) return;
  await git(repoPath, ['reset', 'HEAD', '--', ...files]);
}

export async function discard(repoPath: string, files: string[]): Promise<void> {
  if (!files.length) return;
  await git(repoPath, ['checkout', '--', ...files]);
}

export async function commit(repoPath: string, message: string): Promise<void> {
  if (!message.trim()) throw new Error('Empty commit message');
  await git(repoPath, ['commit', '-m', message]);
}

// --- watcher: emit 'git:changed' when .git/index or HEAD changes -----------

interface Watcher {
  repoPath: string;
  fsWatchers: FSWatcher[];
  pollTimer: NodeJS.Timeout;
  lastFire: number;
}

const watchers = new Map<string, Watcher>();
let mainWindow: BrowserWindow | null = null;

export function attachWindow(win: BrowserWindow): void {
  mainWindow = win;
}

export function detachWindow(): void {
  mainWindow = null;
}

function emitChange(repoPath: string): void {
  const w = watchers.get(repoPath);
  if (!w) return;
  // Debounce: only emit at most once per 800ms.
  const now = Date.now();
  if (now - w.lastFire < 800) return;
  w.lastFire = now;
  sendToWindow(mainWindow, 'git:changed', repoPath);
}

export function watchRepo(repoPath: string): void {
  if (watchers.has(repoPath)) return;
  const gitDir = join(repoPath, '.git');
  if (!existsSync(gitDir)) return;

  const fsWatchers: FSWatcher[] = [];
  for (const name of ['index', 'HEAD']) {
    try {
      const file = join(gitDir, name);
      if (!existsSync(file)) continue;
      const w = watchSync(file, () => emitChange(repoPath));
      fsWatchers.push(w);
    } catch {
      // ignore — fall back to polling
    }
  }
  const pollTimer = setInterval(() => emitChange(repoPath), 5000);
  watchers.set(repoPath, { repoPath, fsWatchers, pollTimer, lastFire: 0 });
}

export function unwatchRepo(repoPath: string): void {
  const w = watchers.get(repoPath);
  if (!w) return;
  for (const fw of w.fsWatchers) fw.close();
  clearInterval(w.pollTimer);
  watchers.delete(repoPath);
}

export function unwatchAll(): void {
  for (const repo of Array.from(watchers.keys())) unwatchRepo(repo);
}
