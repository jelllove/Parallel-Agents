import type { SessionActivity } from './session-activity';

const PRIORITY: Record<SessionActivity, number> = { waiting: 3, running: 2, done: 1 };

export function strongestActivity(
  states: Iterable<SessionActivity | undefined>,
): SessionActivity | null {
  let best: SessionActivity | null = null;
  for (const state of states) {
    if (state && (!best || PRIORITY[state] > PRIORITY[best])) best = state;
  }
  return best;
}

export function projectActivity(
  projectId: string,
  tabProjectId: Record<string, string>,
  tabActivity: Record<string, SessionActivity>,
): SessionActivity | null {
  return strongestActivity(
    Object.entries(tabActivity)
      .filter(([tabId]) => (tabProjectId[tabId] ?? tabId) === projectId)
      .map(([, state]) => state),
  );
}

export function sessionActivity(
  projectId: string,
  sessionId: string,
  tabProjectId: Record<string, string>,
  tabSessionId: Record<string, string | null>,
  tabActivity: Record<string, SessionActivity>,
): SessionActivity | null {
  return strongestActivity(
    Object.entries(tabActivity)
      .filter(
        ([tabId]) =>
          (tabProjectId[tabId] ?? tabId) === projectId && tabSessionId[tabId] === sessionId,
      )
      .map(([, state]) => state),
  );
}
