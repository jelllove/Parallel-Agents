import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import type { FsNode } from '../shared/types';

const IGNORE = new Set(['.git', 'node_modules', '.next', '.turbo', 'dist', 'out', '.cache']);

export async function readDir(path: string): Promise<FsNode[]> {
  let entries: string[];
  try {
    entries = await readdir(path);
  } catch {
    return [];
  }

  const out: FsNode[] = [];
  for (const name of entries) {
    if (IGNORE.has(name)) continue;
    const full = join(path, name);
    let isDir = false;
    try {
      isDir = (await stat(full)).isDirectory();
    } catch {
      continue;
    }
    out.push({ name, path: full, isDirectory: isDir });
  }

  out.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return out;
}
