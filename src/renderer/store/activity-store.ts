import { create } from 'zustand';
import type { SessionActivity, ActivityState } from '../../shared/session-activity';
import { agentTerminalKey } from '../../shared/session-terminals.ts';

interface Snapshot {
  revision: number;
  records: SessionActivity[];
}
interface CompletionAttention {
  token: string;
  acknowledged: boolean;
}
interface ActivityStore extends Snapshot {
  completions: Record<string, CompletionAttention>;
  accept: (snapshot: Snapshot) => void;
  acknowledge: (token: string) => void;
}
export const useActivityStore = create<ActivityStore>((set, get) => ({
  revision: -1,
  records: [],
  completions: {},
  accept(snapshot) {
    if (snapshot.revision <= get().revision) return;
    const previous = get();
    const completions: Record<string, CompletionAttention> = {};
    for (const record of snapshot.records) {
      if (record.state !== 'completed') continue;
      const old = previous.records.find((item) => item.terminalKey === record.terminalKey);
      const attention = previous.completions[record.terminalKey];
      completions[record.terminalKey] =
        old?.state === 'completed' &&
        old.generation === record.generation &&
        old.sessionId === record.sessionId &&
        old.agent === record.agent &&
        attention
          ? attention
          : {
              token: JSON.stringify([
                record.terminalKey,
                record.generation,
                record.agent,
                record.sessionId,
                record.revision,
              ]),
              acknowledged: false,
            };
    }
    set({ ...snapshot, completions });
  },
  acknowledge(token) {
    set((state) => ({
      completions: Object.fromEntries(
        Object.entries(state.completions).map(([key, attention]) => [
          key,
          attention.token === token ? { ...attention, acknowledged: true } : attention,
        ]),
      ),
    }));
  },
}));
export function subscribeActivity() {
  let active = true;
  const accept = (snapshot: Snapshot) => {
    if (active) useActivityStore.getState().accept(snapshot);
  };
  const off = window.api.activity.onChange(accept);
  void window.api.activity
    .snapshot()
    .then(accept)
    .catch(() => {});
  return () => {
    active = false;
    off();
  };
}
export function sessionActivityRecord(
  records: SessionActivity[],
  agent: string,
  sessionId: string,
  tabs: {
    openTabs: string[];
    tabAgent: Record<string, string>;
    tabSessionId: Record<string, string | null>;
  },
): SessionActivity | undefined {
  const keys = new Set(
    tabs.openTabs
      .filter((tab) => tabs.tabAgent[tab] === agent && tabs.tabSessionId[tab] === sessionId)
      .map(agentTerminalKey),
  );
  const record = records
    .filter(
      (record) =>
        keys.has(record.terminalKey) && record.agent === agent && record.sessionId === sessionId,
    )
    .sort((a, b) => b.revision - a.revision)[0];
  return record;
}
export function sessionActivity(
  records: SessionActivity[],
  agent: string,
  sessionId: string,
  tabs: Parameters<typeof sessionActivityRecord>[3],
): ActivityState {
  return sessionActivityRecord(records, agent, sessionId, tabs)?.state ?? 'unknown';
}
