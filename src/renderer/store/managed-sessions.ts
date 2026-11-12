import { useAppStore, sessionHistoryRevision } from './app-store.ts';
import { useActivityStore } from './activity-store.ts';
import { agentTerminalKey } from '../../shared/session-terminals.ts';
import { createHistoryRefreshQueue } from './history-refresh-queue.ts';

export function subscribeManagedSessions() {
  let closed = false;
  let running = false;
  const queue = createHistoryRefreshQueue({
    refresh: (projectId) => useAppStore.getState().loadSessions(projectId),
    failed: () =>
      useAppStore.setState({
        inventoryError: 'Could not refresh a managed session history. Use Refresh to retry.',
      }),
  });
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
              [projectId]: list.some((item) => item.id === session.id)
                ? list.map((item) => (item.id === session.id ? session : item))
                : [session, ...list],
            },
          });
          queue.request([projectId]);
        } catch {
          /* The coding terminal remains usable; a normal refresh can expose I/O errors. */
        }
      }
      const state = useAppStore.getState();
      queue.request(
        entries
          .filter(([tabId]) => state.openTabs.includes(tabId) && !state.tabSessionId[tabId])
          .map(([tabId]) => state.tabProjectId[tabId]),
      );
    } finally {
      running = false;
    }
  };
  const offActivity = useActivityStore.subscribe((next, previous) => {
    if (next.records === previous.records) return; // Local completion acknowledgement is not I/O.
    const state = useAppStore.getState();
    const dirty = new Set<string>();
    let pendingIdentity = false;
    for (const record of next.records) {
      const old = previous.records.find((item) => item.terminalKey === record.terminalKey);
      if (
        old?.generation === record.generation &&
        old.sessionId === record.sessionId &&
        old.state === record.state
      )
        continue;
      const tab = state.openTabs.find((id) => agentTerminalKey(id) === record.terminalKey);
      if (!tab) continue;
      if (!state.tabSessionId[tab]) pendingIdentity = true;
      if (record.sessionId !== old?.sessionId || ['completed', 'failed'].includes(record.state))
        dirty.add(state.tabProjectId[tab]);
    }
    queue.request(dirty);
    if (pendingIdentity) void refresh();
  });
  let ticks = 0;
  const timer = window.setInterval(() => {
    const hidden = document.hidden;
    if (hidden && ++ticks % 20 !== 0) return;
    if (!hidden) ticks++;
    void refresh();
    if (ticks % (hidden ? 20 : 5) === 0) {
      const state = useAppStore.getState();
      queue.request(state.openTabs.map((id) => state.tabProjectId[id]));
    }
  }, 3000);
  const onVisible = () => {
    if (document.hidden) return;
    const state = useAppStore.getState();
    queue.request(state.openTabs.map((id) => state.tabProjectId[id]));
    void refresh();
  };
  document.addEventListener('visibilitychange', onVisible);
  void refresh();
  return () => {
    closed = true;
    queue.close();
    offActivity();
    document.removeEventListener('visibilitychange', onVisible);
    window.clearInterval(timer);
  };
}
