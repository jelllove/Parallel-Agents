import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, sep } from 'node:path';
import type {
  DeleteTarget,
  ReviewedSession,
  SessionDeletionPreview,
  SessionDeletionResult,
} from '../shared/session-deletion.ts';
import type { LinkedWorktree } from './worktrees.ts';

interface Dependencies {
  inventory(): Promise<ReviewedSession[]>;
  inspect(path: string): Promise<LinkedWorktree | null>;
  delete(target: ReviewedSession): Promise<void | string[]>;
  remove(worktree: LinkedWorktree): Promise<void>;
  idle(worktree: LinkedWorktree): Promise<void>;
  guard<T>(path: string, run: () => Promise<T>): Promise<T>;
  forget(path: string): Promise<void>;
}
interface Review {
  preview: SessionDeletionPreview;
  checkouts: Map<string, LinkedWorktree>;
  created: number;
  phase: 'review' | 'deleting' | 'deleted' | 'finishing';
  selected: string[];
  result: SessionDeletionResult;
}
const identity = (target: ReviewedSession) => `${target.agent}:${target.sessionId}`;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
export function withinCheckout(root: string, path: string): boolean {
  const part = relative(root, path);
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`));
}

/** Preview tokens authorize only captured native identities, never a future inventory. */
export class SessionDeletionService {
  private reviews = new Map<string, Review>();
  private dependencies: Dependencies;
  constructor(dependencies: Dependencies) {
    this.dependencies = dependencies;
  }

  async preview(targets: DeleteTarget[]): Promise<SessionDeletionPreview> {
    if (
      !Array.isArray(targets) ||
      !targets.length ||
      targets.length > 1000 ||
      targets.some(
        (target) =>
          !target ||
          typeof target.projectId !== 'string' ||
          typeof target.sessionId !== 'string' ||
          target.projectId.length > 4096 ||
          target.sessionId.length > 2000,
      )
    )
      throw new Error('Invalid session deletion request.');
    const inventory = await this.dependencies.inventory();
    const sessions = targets
      .map((target) => {
        const found = inventory.find(
          (item) => item.projectId === target.projectId && item.sessionId === target.sessionId,
        );
        if (!found)
          throw new Error('A selected session is no longer available. Refresh before deleting.');
        return found;
      })
      .filter(
        (item, index, list) =>
          list.findIndex((other) => identity(other) === identity(item)) === index,
      );
    const token = randomUUID();
    const checkouts = new Map<string, LinkedWorktree>();
    let cleanupWarning: string | undefined;
    for (const session of sessions) {
      try {
        const worktree = await this.dependencies.inspect(session.cwd);
        if (worktree && !checkouts.has(worktree.root)) checkouts.set(worktree.root, worktree);
      } catch (error) {
        cleanupWarning = `Optional worktree removal is unavailable: ${message(error)}`;
      }
    }
    // Broken optional Git metadata must not prevent ordinary native-history deletion.
    if (cleanupWarning) checkouts.clear();
    const selected = new Set(sessions.map(identity));
    const preview: SessionDeletionPreview = {
      token,
      sessions,
      ...(cleanupWarning ? { cleanupWarning } : {}),
      worktrees: [...checkouts].map(([key, worktree]) => ({
        key,
        path: worktree.root,
        branch: worktree.branch,
        additional: inventory
          .filter(
            (item) => withinCheckout(worktree.root, item.cwd) && !selected.has(identity(item)),
          )
          .filter(
            (item, index, list) =>
              list.findIndex((other) => identity(other) === identity(item)) === index,
          ),
        blocked: worktree.locked
          ? 'This worktree is locked.'
          : inventory.some(
                (item) =>
                  item.ownershipUncertain &&
                  (withinCheckout(worktree.parentPath, item.cwd) ||
                    withinCheckout(worktree.root, item.cwd)),
              )
            ? 'Shared history has ambiguous checkout ownership; worktree removal is unavailable.'
            : undefined,
      })),
    };
    const now = Date.now();
    for (const [key, review] of this.reviews)
      if (review.phase === 'review' && now - review.created > 15 * 60_000) this.reviews.delete(key);
    if (this.reviews.size >= 64)
      throw new Error('Too many pending deletion reviews. Finish the current operations first.');
    this.reviews.set(token, {
      preview,
      checkouts,
      created: now,
      phase: 'review',
      selected: [],
      result: { deleted: [], failures: [], removedWorktrees: [], retainedWorktrees: [] },
    });
    return preview;
  }
  cancel(token: string): void {
    if (this.reviews.get(token)?.phase === 'review') this.reviews.delete(token);
  }
  async deleteReviewed(token: string, worktreeKeys: string[]): Promise<SessionDeletionResult> {
    const review = this.reviews.get(token);
    if (!review || review.phase !== 'review' || Date.now() - review.created > 15 * 60_000)
      throw new Error('Deletion review expired; review again.');
    if (
      !Array.isArray(worktreeKeys) ||
      worktreeKeys.length > review.checkouts.size ||
      new Set(worktreeKeys).size !== worktreeKeys.length ||
      worktreeKeys.some(
        (key) =>
          !review.checkouts.has(key) ||
          review.preview.worktrees.find((item) => item.key === key)?.blocked,
      )
    )
      throw new Error('Invalid worktree cleanup selection.');
    review.phase = 'deleting';
    review.selected = [...worktreeKeys];
    const targets = [
      ...review.preview.sessions,
      ...review.preview.worktrees
        .filter((item) => worktreeKeys.includes(item.key))
        .flatMap((item) => item.additional),
    ].filter(
      (item, index, all) => all.findIndex((other) => identity(other) === identity(item)) === index,
    );
    try {
      for (const key of review.selected) {
        const expected = review.checkouts.get(key)!;
        const current = await this.dependencies.inspect(expected.root);
        if (!current || current.identity !== expected.identity)
          throw new Error('Worktree identity changed; review again before deleting its histories.');
      }
      const current = await this.dependencies.inventory();
      for (const target of targets) {
        try {
          if (
            !current.some((item) => identity(item) === identity(target) && item.cwd === target.cwd)
          )
            throw new Error('Session identity or checkout changed; review again.');
          const warnings = await this.dependencies.delete(target);
          review.result.deleted.push(target);
          if (warnings) review.result.failures.push(...warnings);
        } catch (error) {
          review.result.failures.push(`${target.title}: ${message(error)}`);
        }
      }
    } catch (error) {
      review.result.failures.push(message(error));
    }
    review.phase = 'deleted';
    return structuredClone(review.result);
  }
  async finish(token: string): Promise<SessionDeletionResult> {
    const review = this.reviews.get(token);
    if (!review || review.phase !== 'deleted')
      throw new Error('Deletion is not ready for worktree cleanup.');
    review.phase = 'finishing';
    try {
      for (const key of review.selected) {
        const worktree = review.checkouts.get(key)!;
        try {
          await this.dependencies.guard(worktree.root, async () => {
            const required = [
              ...review.preview.sessions,
              ...review.preview.worktrees.find((item) => item.key === key)!.additional,
            ].filter((item) => withinCheckout(worktree.root, item.cwd));
            if (
              required.some(
                (target) =>
                  !review.result.deleted.some((item) => identity(item) === identity(target)),
              )
            )
              throw new Error('Some reviewed histories could not be deleted.');
            await this.dependencies.idle(worktree);
            const inventory = await this.dependencies.inventory();
            if (
              inventory.some(
                (item) =>
                  withinCheckout(worktree.root, item.cwd) ||
                  (item.ownershipUncertain && withinCheckout(worktree.parentPath, item.cwd)),
              )
            )
              throw new Error('New or remaining histories use this worktree.');
            await this.dependencies.remove(worktree);
            review.result.removedWorktrees.push(worktree.root);
            try {
              await this.dependencies.forget(worktree.root);
            } catch (error) {
              review.result.failures.push(
                `Worktree removed, but local metadata cleanup failed: ${message(error)}`,
              );
            }
          });
        } catch (error) {
          review.result.retainedWorktrees.push(`${worktree.root}: ${message(error)}`);
        }
      }
      return structuredClone(review.result);
    } finally {
      this.reviews.delete(token);
    }
  }
}
