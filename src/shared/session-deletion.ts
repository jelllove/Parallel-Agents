import type { AgentId } from './types.ts';

export interface DeleteTarget {
  projectId: string;
  sessionId: string;
}
export interface ReviewedSession extends DeleteTarget {
  agent: AgentId;
  title: string;
  cwd: string;
  ownershipUncertain?: boolean;
  /** Fresh canonical history-checkout scope, distinct from a lossy display-path fallback. */
  ownershipScope?: string;
}
export interface WorktreeReview {
  key: string;
  path: string;
  branch: string | null;
  additional: ReviewedSession[];
  blockers?: ReviewedSession[];
  blocked?: string;
}
export interface SessionDeletionPreview {
  token: string;
  sessions: ReviewedSession[];
  worktrees: WorktreeReview[];
  cleanupWarning?: string;
}
export interface SessionDeletionResult {
  deleted: ReviewedSession[];
  failures: string[];
  removedWorktrees: string[];
  retainedWorktrees: string[];
}
