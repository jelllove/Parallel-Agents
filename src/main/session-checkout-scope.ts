import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';
import type { RegisteredProject } from '../shared/types.ts';
import { findProjectRepositoryRoot, listProjectWorktreePaths } from './worktrees.ts';

/** Scope a missing-cwd history using existing registrations and Git, never a decoded path guess.
 * This can exclude another checkout from a cleanup review; it cannot authorize deleting this history.
 */
export async function resolveHistoryCheckoutScope(
  projectId: string,
  registrations: readonly RegisteredProject[],
): Promise<string | undefined> {
  if (!projectId.startsWith('claude:')) return undefined;
  const key = (value: string) => (process.platform === 'win32' ? value.toLowerCase() : value);
  const historyDirectory = projectId.slice('claude:'.length);
  const encode = (path: string) => key(normalize(path).replace(/[^a-zA-Z0-9]/g, '-'));
  const candidates = registrations.filter((project) => {
    if (project.agent !== 'claude') return false;
    if (project.id === projectId) return true;
    // Claude's encoding is lossy, so require a unique canonical candidate below. Do not reverse it.
    return encode(project.historyPath ?? project.realPath) === key(historyDirectory);
  });
  if (!candidates.length) return undefined;
  const scopes = new Set<string>();
  for (const project of candidates) {
    const path = project.historyPath ?? project.realPath;
    if (!isAbsolute(path)) return undefined;
    try {
      const canonical = await realpath(path);
      if (!(await stat(canonical)).isDirectory()) return undefined;
      const root = await findProjectRepositoryRoot(canonical);
      if (!root) return undefined;
      // Check every Git-reported spelling in this repository for lossy-key collisions too.
      // A single saved registration must not hide another possible matching checkout.
      for (const checkout of await listProjectWorktreePaths(root)) {
        if (encode(checkout) !== encode(path)) continue;
        scopes.add(key(await realpath(checkout)));
      }
      scopes.add(key(await realpath(root)));
    } catch {
      // Missing paths or broken optional Git evidence leave the conservative block in place.
      return undefined;
    }
  }
  return scopes.size === 1 ? scopes.values().next().value : undefined;
}
