import { stat } from 'node:fs/promises';
import type { PreferencesStore } from './preferences-store.ts';
import { inspectLinkedWorktree } from './worktrees.ts';

export async function eligibleRecentFolders(folders: string[]): Promise<string[]> {
  const result: string[] = [];
  for (const folder of [...new Set(folders)]) {
    try {
      if (!(await stat(folder)).isDirectory()) continue;
      if (!(await inspectLinkedWorktree(folder))) result.push(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new Error(
        `Could not inspect recent folder "${folder}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  return result;
}

export async function readRecentFolders(store: PreferencesStore): Promise<string[]> {
  return eligibleRecentFolders((await store.read()).recentFolders);
}
export async function recordRecentFolder(store: PreferencesStore, path: string): Promise<void> {
  if ((await eligibleRecentFolders([path])).length) await store.addRecentFolder(path);
}
