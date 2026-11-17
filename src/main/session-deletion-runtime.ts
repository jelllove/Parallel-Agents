import { realpath } from 'node:fs/promises';
import { listProjects, resolveHistoryProjectPath } from './projects.ts';
import { listSessionsForProject, deleteSession } from './sessions.ts';
import { inspectLinkedWorktree, removeLinkedWorktree } from './worktrees.ts';
import { preferences } from './preferences-store.ts';
import { forgetProject, removeSessionOrder } from './config.ts';
import { ptyManager } from './pty-manager.ts';
import { managedSessions } from './managed-session-runtime.ts';
import { guardCheckout } from './checkout-guard.ts';
import { SessionDeletionService, withinCheckout } from './session-deletion-service.ts';
import type { ReviewedSession } from '../shared/session-deletion.ts';
import type { Session, RegisteredProject } from '../shared/types.ts';
import { resolveHistoryCheckoutScope } from './session-checkout-scope.ts';
import { withFreshHistory } from './history-read-context.ts';

async function reviewSession(
  session: Session,
  fallback: string,
  ownershipScope?: string,
): Promise<ReviewedSession> {
  let cwd = session.cwd ?? fallback;
  try {
    cwd = await realpath(cwd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Missing histories remain deletable, but cannot authorize checkout removal.
  }
  return {
    projectId: session.projectId,
    sessionId: session.id,
    agent: session.agent,
    title: session.title,
    cwd,
    ...(!session.cwd
      ? { ownershipUncertain: true, ...(ownershipScope ? { ownershipScope } : {}) }
      : {}),
  };
}

export const sessionDeletion = new SessionDeletionService({
  resolve: (targets) =>
    withFreshHistory(async () => {
      const entries: ReviewedSession[] = [];
      for (const projectId of new Set(targets.map((target) => target.projectId))) {
        const wanted = new Set(
          targets
            .filter((target) => target.projectId === projectId)
            .map((target) => target.sessionId),
        );
        const sessions = await listSessionsForProject(projectId, true, wanted);
        // Only providers without recorded cwd need the project's fallback path. This lookup does
        // not decorate inventory with Git metadata, including for manually registered workspaces.
        const fallback = sessions.some((session) => !session.cwd)
          ? await resolveHistoryProjectPath(projectId)
          : '';
        for (const session of sessions) entries.push(await reviewSession(session, fallback));
      }
      return entries;
    }),
  inventory: () =>
    withFreshHistory(async () => {
      const projects = await listProjects(true);
      const entries: ReviewedSession[] = [];
      let registrations: RegisteredProject[] | undefined;
      for (const project of projects) {
        const sessions = await listSessionsForProject(project.id, true);
        let scope: string | undefined;
        if (sessions.some((session) => !session.cwd)) {
          registrations ??= (await preferences.read()).projects;
          scope = await resolveHistoryCheckoutScope(
            project.historyProjectId ?? project.id,
            registrations,
          );
        }
        for (const session of sessions) {
          entries.push(await reviewSession(session, project.realPath, scope));
        }
      }
      return entries;
    }),
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
