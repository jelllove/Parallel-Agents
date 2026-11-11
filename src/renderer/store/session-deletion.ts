import type {
  SessionDeletionPreview,
  SessionDeletionResult,
} from '../../shared/session-deletion.ts';
import { useAppStore } from './app-store.ts';
import { useBackgroundOperations } from './background-operations.ts';

export function queueReviewedSessionDeletion(
  preview: SessionDeletionPreview,
  worktreeKeys: string[],
) {
  const selected = [...worktreeKeys];
  const all = [
    ...preview.sessions,
    ...preview.worktrees
      .filter((item) => selected.includes(item.key))
      .flatMap((item) => item.additional),
  ];
  return useBackgroundOperations.getState().enqueue({
    key: `delete-reviewed:${preview.token}`,
    title: `Delete ${all.length} session${all.length === 1 ? '' : 's'}`,
    resources: [
      ...new Set(all.map((item) => `delete-session:${item.agent}:${item.sessionId}`)),
      ...selected.map((key) => `worktree:${key}`),
    ],
    run: async () => {
      let result: SessionDeletionResult = await window.api.sessions.deleteReviewed(
        preview.token,
        selected,
      );
      useAppStore.getState().applyDeletedSessions(result.deleted);
      // closeTabs sends native kill requests before this finish request on the same IPC channel.
      try {
        result = await window.api.sessions.finishDeletion(preview.token);
      } catch (error) {
        result.failures.push(
          `Session deletion completed, but checkout cleanup failed: ${String(error)}`,
        );
      }
      // Removed worktree registrations no longer accept history reads. Refresh inventory first,
      // then refresh only surviving projects (including previously loaded shared-history aliases).
      const refreshed = await Promise.allSettled([useAppStore.getState().loadProjects()]);
      const ids = new Set([
        ...all.map((item) => item.projectId),
        ...Object.keys(useAppStore.getState().sessions),
      ]);
      refreshed.push(
        ...(await Promise.allSettled(
          [...ids]
            .filter((id) => useAppStore.getState().findProject(id))
            .map((id) => useAppStore.getState().loadSessions(id)),
        )),
      );
      const errors = refreshed.flatMap((item) =>
        item.status === 'rejected'
          ? [`Refreshing history/projects failed: ${String(item.reason)}`]
          : [],
      );
      return {
        warning: Boolean(
          result.failures.length || result.retainedWorktrees.length || errors.length,
        ),
        message: [
          `${result.deleted.length} sessions deleted.`,
          ...result.removedWorktrees.map((path) => `Worktree removed: ${path}. Branch retained.`),
          ...result.retainedWorktrees.map((reason) => `Worktree retained: ${reason}`),
          ...result.failures,
          ...errors,
        ].join(' '),
      };
    },
  });
}
