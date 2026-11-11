import { realpath } from 'node:fs/promises';
import { listProjects } from './projects.ts';
import { listSessionsForProject, deleteSession } from './sessions.ts';
import { inspectLinkedWorktree, removeLinkedWorktree } from './worktrees.ts';
import { preferences } from './preferences-store.ts';
import { forgetProject, removeSessionOrder } from './config.ts';
import { ptyManager } from './pty-manager.ts';
import { managedSessions } from './managed-session-runtime.ts';
import { guardCheckout } from './checkout-guard.ts';
import { SessionDeletionService, withinCheckout } from './session-deletion-service.ts';
import type { ReviewedSession } from '../shared/session-deletion.ts';

export const sessionDeletion = new SessionDeletionService({
  async inventory() {
    const projects = await listProjects();
    const entries: ReviewedSession[] = [];
    for (const project of projects) {
      for (const session of await listSessionsForProject(project.id)) {
        let cwd = session.cwd ?? project.realPath;
        try {
          cwd = await realpath(cwd);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          // Missing histories remain deletable, but cannot authorize checkout removal.
        }
        entries.push({
          projectId: project.id,
          sessionId: session.id,
          agent: session.agent,
          title: session.title,
          cwd,
          ...(!session.cwd ? { ownershipUncertain: true } : {}),
        });
      }
    }
    return entries;
  },
  async inspect(path) {
    try {
      return await inspectLinkedWorktree(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  },
  async delete(target) {
    await deleteSession(target.projectId, target.sessionId);
    managedSessions.cancelSession(target.agent, target.sessionId);
    // Native deletion has already succeeded: a metadata failure must not make it look undone.
    const metadata = await Promise.allSettled([
      removeSessionOrder(`${target.agent}:${target.sessionId}`),
      preferences.forgetSessionTitle(target.agent, target.sessionId),
    ]);
    return metadata.flatMap((result) =>
      result.status === 'rejected'
        ? [
            `${target.title}: history deleted, but clearing local metadata failed: ${String(result.reason)}`,
          ]
        : [],
    );
  },
  remove: removeLinkedWorktree,
  async idle(worktree) {
    await ptyManager.waitForCheckoutIdle(async (cwd) =>
      withinCheckout(worktree.root, await realpath(cwd)),
    );
  },
  guard: guardCheckout,
  async forget(path) {
    const projects = (await listProjects()).filter((project) => {
      return withinCheckout(path, project.realPath);
    });
    await preferences.forgetCheckout(path);
    for (const project of projects) await forgetProject(project.id);
  },
});
