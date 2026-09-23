import type { WorktreeMember } from './project-policies.ts';

let members = new Map<string, WorktreeMember[]>();

export function setWorktreeMembers(next: Map<string, WorktreeMember[]>): void {
  members = next;
}

export function worktreeMembersOf(projectId: string): WorktreeMember[] | undefined {
  return members.get(projectId);
}
