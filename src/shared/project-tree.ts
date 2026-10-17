import type { Project, Session } from './types.ts';

export interface ProjectTree {
  id: string;
  name: string;
  path: string;
  project: Project;
  projects: Project[];
}

function pathKey(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function groupProjectTrees(projects: Project[], showHidden = false): ProjectTree[] {
  const groups = new Map<string, ProjectTree>();
  for (const project of projects) {
    if (project.hidden && !showHidden) continue;
    const path = project.worktree?.parentPath ?? project.realPath;
    const id = `${project.agent}:${pathKey(path)}`;
    const group = groups.get(id);
    if (group) {
      group.projects.push(project);
      if (!project.worktree) {
        group.project = project;
        group.name = project.displayName;
        group.path = project.realPath;
      }
    } else {
      groups.set(id, {
        id,
        name: project.worktree
          ? path.split(/[\\/]/).filter(Boolean).at(-1) || path
          : project.displayName,
        path,
        project,
        projects: [project],
      });
    }
  }
  return [...groups.values()];
}

export interface ProjectSession {
  project: Project;
  session: Session;
}

export function collectProjectSessions(
  projects: Project[],
  sessions: Record<string, Session[]>,
): ProjectSession[] {
  const rows = new Map<string, ProjectSession>();
  for (const project of projects) {
    for (const session of sessions[project.id] ?? []) {
      const key = `${session.agent}:${session.id}`;
      const existing = rows.get(key);
      if (!existing || (session.cwd && pathKey(session.cwd) === pathKey(project.realPath))) {
        rows.set(key, { project, session });
      }
    }
  }
  return [...rows.values()].sort((a, b) => b.session.timestamp - a.session.timestamp);
}
