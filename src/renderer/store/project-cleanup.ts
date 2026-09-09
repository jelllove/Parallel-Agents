import type { AgentId, Project } from '../../shared/types';

const DELETABLE_MISSING_AGENTS = new Set<AgentId>(['claude', 'gemini', 'copilot']);

export function pickDeletableMissingProjectIds(
  projects: Project[],
  candidateIds: string[],
): string[] {
  const uniqueIds = [...new Set(candidateIds)];
  const byId = new Map(projects.map((project) => [project.id, project]));
  return uniqueIds.filter((id) => {
    const project = byId.get(id);
    return !!project
      && !project.exists
      && DELETABLE_MISSING_AGENTS.has(project.agent);
  });
}
