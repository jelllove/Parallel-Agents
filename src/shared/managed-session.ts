import type { AgentId, Project, Session } from './types.ts';

export interface ManagedTab {
  createdAt: number;
  sessionTitle?: string;
  launchId: string;
}
export interface ManagedSessionResult {
  session: Session | null;
}
export type SidebarSessionRow =
  | { kind: 'history'; project: Project; session: Session }
  | { kind: 'draft'; project: Project; tabId: string; createdAt: number; title: string };

export function draftSessionRows(
  projects: Project[],
  tabs: {
    openTabs: string[];
    tabProjectId: Record<string, string>;
    tabSessionId: Record<string, string | null>;
    tabAgent: Record<string, AgentId>;
    managedTabs: Record<string, ManagedTab>;
  },
): SidebarSessionRow[] {
  return tabs.openTabs.flatMap<SidebarSessionRow>((tabId) => {
    const project = projects.find((item) => item.id === tabs.tabProjectId[tabId]);
    const managed = tabs.managedTabs[tabId];
    return project && managed && !tabs.tabSessionId[tabId] && project.agent === tabs.tabAgent[tabId]
      ? [
          {
            kind: 'draft',
            project,
            tabId,
            createdAt: managed.createdAt,
            title: managed.sessionTitle || 'New session',
          },
        ]
      : [];
  });
}
