import { app } from 'electron';
import { readdir, stat, createReadStream } from 'fs';
import { promisify } from 'util';
import { createInterface } from 'readline';
import { join } from 'path';
import type { Session } from '../shared/types';

const readdirP = promisify(readdir);
const statP = promisify(stat);

const PROJECTS_ROOT = join(app.getPath('home'), '.claude', 'projects');

const TITLE_MAX = 80;

function extractTitle(content: unknown): string {
  if (typeof content === 'string') {
    const trimmed = content.trim().replace(/\s+/g, ' ');
    return trimmed.length > TITLE_MAX ? trimmed.slice(0, TITLE_MAX) + '…' : trimmed;
  }
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === 'object' && 'type' in part && (part as any).type === 'text') {
        return extractTitle((part as any).text);
      }
    }
  }
  return '(empty)';
}

async function readFirstUserMessage(filePath: string): Promise<{
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
      if (done) return;
      if (!line) return;
      let rec: any;
      try {
        rec = JSON.parse(line);
      } catch {
        return;
      }
      if (rec.type !== 'user' || rec.isSidechain) return;
      const content = rec.message?.content;
      done = true;
      rl.close();
      resolve({
        title: extractTitle(content),
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

export async function listSessionsForProject(projectId: string): Promise<Session[]> {
  const dir = join(PROJECTS_ROOT, projectId);
  let files: string[];
  try {
    files = await readdirP(dir);
  } catch {
    return [];
  }
  const jsonl = files.filter((f) => f.endsWith('.jsonl'));

  const out: Session[] = [];
  for (const f of jsonl) {
    const full = join(dir, f);
    const id = f.replace(/\.jsonl$/, '');
    let mtime = 0;
    try {
      mtime = (await statP(full)).mtimeMs;
    } catch {}
    const meta = await readFirstUserMessage(full);
    out.push({
      id,
      projectId,
      title: meta?.title ?? '(no user message)',
      timestamp: meta?.timestamp ?? mtime,
      cwd: meta?.cwd ?? null,
      gitBranch: meta?.gitBranch ?? null,
      version: meta?.version ?? null,
    });
  }

  out.sort((a, b) => b.timestamp - a.timestamp);
  return out;
}
