import type { NewProjectOptions, Project, Session } from '../../shared/types.ts';
import type { ProjectSession } from '../../shared/project-tree.ts';
import { useAppStore } from './app-store.ts';
import { useBackgroundOperations } from './background-operations.ts';

function pathKey(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function queueProjectCreation(options: NewProjectOptions) {
  const snapshot = { ...options };
  const state = useAppStore.getState();
  const selected = state.selectedProjectId;
  const active = state.activeTabId;
  let navigated = false;
  const unsubscribe = useAppStore.subscribe((next) => {
    if (next.selectedProjectId !== selected || next.activeTabId !== active) navigated = true;
  });
  const id = useBackgroundOperations.getState().enqueue({
    key: `create:${snapshot.agent}:${pathKey(snapshot.mode === 'worktree' ? (snapshot.targetPath ?? '') : snapshot.basePath)}`,
    title:
      snapshot.mode === 'worktree'
        ? `Create branch ${snapshot.branch}`
        : `Open project ${snapshot.basePath}`,
    run: async () => {
      try {
        return await useAppStore.getState().createProject(snapshot, () => !navigated);
      } finally {
        unsubscribe();
      }
    },
  });
  if (id === null) unsubscribe();
  return id;
}

export function queueProjectDeletion(projects: Project[], missingOnly = false) {
  const snapshot = projects.map((project) => ({
    id: project.id,
    displayName: project.displayName,
  }));
  const ids = snapshot.map((project) => project.id);
  return useBackgroundOperations.getState().enqueue({
    key: `delete-projects:${JSON.stringify([...ids].sort())}`,
    resources: ids.map((id) => `project:${id}`),
    title: `Delete ${snapshot.length === 1 ? snapshot[0].displayName : `${snapshot.length} project histories`}`,
    run: async () => {
      return missingOnly
        ? useAppStore.getState().deleteMissingProjects(ids)
        : useAppStore.getState().deleteProject(ids[0]);
    },
  });
}

export function queueSessionsDeletion(targets: ProjectSession[]) {
  const snapshot = targets.map(({ project, session }) => ({
    project: { ...project },
    session: { ...session },
  }));
  const resources = [
    ...new Set(snapshot.map(({ session }) => `delete-session:${session.agent}:${session.id}`)),
  ];
  if (!resources.length) throw new Error('No sessions selected');
  return useBackgroundOperations.getState().enqueue({
    key: `delete-sessions:${JSON.stringify([...resources].sort())}`,
    resources,
    title: `Delete ${resources.length} sessions`,
    run: () => useAppStore.getState().deleteSessions(snapshot),
  });
}

export function queueSessionDeletion(project: Project, session: Session) {
  const projectId = project.id;
  const { id, agent, title } = session;
  return useBackgroundOperations.getState().enqueue({
    key: `delete-session:${agent}:${id}`,
    title: `Delete session ${title || '(empty)'}`,
    run: async () => {
      return useAppStore.getState().deleteSession(projectId, id);
    },
  });
}
