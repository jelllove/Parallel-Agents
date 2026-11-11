import { useAppStore, sessionHistoryRevision } from './app-store.ts';
import { useActivityStore } from './activity-store.ts';
import { agentTerminalKey } from '../../shared/session-terminals.ts';

export function subscribeManagedSessions() {
  let closed = false;
  let running = false;
  const refresh = async () => {
    if (closed || running) return;
    running = true;
    try {
      const entries = Object.entries(useAppStore.getState().managedTabs);
      for (const [tabId, launch] of entries) {
        if (closed) break;
        const initial = useAppStore.getState();
        if (!initial.openTabs.includes(tabId)) continue;
        const projectId = initial.tabProjectId[tabId];
        if (initial.tabSessionId[tabId]) continue;
        try {
          const historyRevision = sessionHistoryRevision();
          const result = await window.api.sessions.inspectManaged(
            agentTerminalKey(tabId),
            launch.launchId,
          );
          const state = useAppStore.getState();
          if (
            closed ||
            historyRevision !== sessionHistoryRevision() ||
            !result.session ||
            !state.openTabs.includes(tabId) ||
            state.managedTabs[tabId]?.launchId !== launch.launchId ||
            state.tabProjectId[tabId] !== projectId ||
            state.tabAgent[tabId] !== result.session.agent
          )
            continue;
          const session = result.session;
          if (state.tabSessionId[tabId] && state.tabSessionId[tabId] !== session.id) continue;
          if (
            state.openTabs.some(
              (other) =>
                other !== tabId &&
                state.tabAgent[other] === session.agent &&
                state.tabSessionId[other] === session.id,
            )
          )
            continue;
          const baselines = { ...state.tabSessionBaseline };
          delete baselines[tabId];
          const list = state.sessions[projectId] ?? [];
          useAppStore.setState({
            tabSessionId: { ...state.tabSessionId, [tabId]: session.id },
            tabSessionBaseline: baselines,
            sessions: {
              ...state.sessions,
              [projectId]: list.some((item) => item.id === session.id) ? list : [session, ...list],
            },
          });
        } catch {
          /* The coding terminal remains usable; a normal refresh can expose I/O errors. */
        }
      }
      const state = useAppStore.getState();
      const projects = new Set(entries.map(([tabId]) => state.tabProjectId[tabId]).filter(Boolean));
      const refreshes = await Promise.allSettled(
        [...projects].map((projectId) => state.loadSessions(projectId)),
      );
      if (!closed && refreshes.some((result) => result.status === 'rejected'))
        useAppStore.setState({
          inventoryError: 'Could not refresh a managed session history. Use Refresh to retry.',
        });
    } finally {
      running = false;
    }
  };
  const offActivity = useActivityStore.subscribe(() => {
    void refresh();
  });
  const timer = window.setInterval(() => {
    void refresh();
  }, 3000);
  void refresh();
  return () => {
    closed = true;
    offActivity();
    window.clearInterval(timer);
  };
}
