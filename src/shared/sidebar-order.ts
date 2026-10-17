import type { AgentId, AgentLayout } from './types.ts';

export const DEFAULT_AGENT_ORDER: readonly AgentId[] = [
  'copilot',
  'codex',
  'claude',
  'gemini',
  'aider',
];

export function orderedAgents(layout: AgentLayout): AgentId[] {
  return [...layout.agentOrder].sort(
    (a, b) => Number(layout.pinnedAgents.includes(b)) - Number(layout.pinnedAgents.includes(a)),
  );
}

export function moveSidebarItem<T extends string>(ids: readonly T[], from: T, to: T): T[] {
  const fromIndex = ids.indexOf(from);
  const toIndex = ids.indexOf(to);
  if (fromIndex < 0 || toIndex < 0) throw new Error('The item is no longer in this sidebar group.');
  const next = [...ids];
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, from);
  return next;
}
