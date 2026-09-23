import type { Project } from '../shared/types.ts';

export interface CopilotScanResult {
  projects: Project[];
  valid: boolean;
  candidateCount: number;
  parsedCount: number;
}

const DELETABLE_AGENTS = new Set(['claude', 'codex', 'gemini', 'copilot']);

export function stabilizeCopilotProjects(previous: Project[], scan: CopilotScanResult): Project[] {
  if (!scan.valid || (scan.candidateCount > 0 && scan.parsedCount === 0)) return previous;
  return scan.projects;
}

export function removeProjectsFromSnapshot(snapshot: Project[], ids: string[]): Project[] {
  const removed = new Set(ids);
  return snapshot.filter((project) => !removed.has(project.id));
}

export function validateMissingProjectIds(projects: Project[], ids: string[]): Project[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  return [...new Set(ids)].map((id) => {
    const project = byId.get(id);
    if (!project) throw new Error(`Unknown project: ${id}`);
    if (!DELETABLE_AGENTS.has(project.agent)) {
      throw new Error(`Delete not supported for agent: ${project.agent}`);
    }
    if (project.exists) throw new Error(`Project is not missing: ${id}`);
    return project;
  });
}

export interface WorktreeIdentity {
  commonDir: string;
  mainPath: string;
}

export interface WorktreeMember {
  id: string;
  realPath: string;
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) =>
    p
      .replace(/[\\/]+/g, '/')
      .replace(/\/$/, '')
      .toLowerCase();
  return norm(a) === norm(b);
}

function leafName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function earliest(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return Math.min(a, b);
}

// One entry per agent + repository; members keep each folder's own history id.
export function mergeWorktreeProjects(
  projects: Project[],
  identityOf: (project: Project) => WorktreeIdentity | null,
): { projects: Project[]; members: Map<string, WorktreeMember[]> } {
  const groups = new Map<string, { identity: WorktreeIdentity; items: Project[] }>();
  const out: Project[] = [];
  for (const project of projects) {
    const identity = project.exists ? identityOf(project) : null;
    if (!identity) {
      out.push(project);
      continue;
    }
    const key = `${project.agent} ${identity.commonDir}`;
    const group = groups.get(key) ?? { identity, items: [] };
    group.items.push(project);
    groups.set(key, group);
  }

  const members = new Map<string, WorktreeMember[]>();
  for (const { identity, items } of groups.values()) {
    if (items.length === 1) {
      out.push(items[0]);
      continue;
    }
    const ordered = [
      ...items.filter((p) => samePath(p.realPath, identity.mainPath)),
      ...items.filter((p) => !samePath(p.realPath, identity.mainPath)),
    ];
    const lead = ordered[0];
    let lastActivity: number | null = null;
    let createdAt: number | null = null;
    for (const item of ordered) {
      if (item.lastActivity !== null && (lastActivity === null || item.lastActivity > lastActivity))
        lastActivity = item.lastActivity;
      createdAt = earliest(createdAt, item.createdAt);
    }
    out.push({
      ...lead,
      displayName: leafName(identity.mainPath),
      sessionCount: ordered.reduce((sum, item) => sum + item.sessionCount, 0),
      lastActivity,
      createdAt,
      pinned: ordered.some((item) => item.pinned),
      hidden: ordered.every((item) => item.hidden),
      worktreeCount: ordered.length,
      worktrees: ordered
        .filter((item) => !samePath(item.realPath, identity.mainPath))
        .map((item) => ({ realPath: item.realPath, exists: item.exists })),
    });
    members.set(
      lead.id,
      ordered.map((item) => ({ id: item.id, realPath: item.realPath })),
    );
  }
  return { projects: out, members };
}
