export interface ArrangementItem {
  key: string;
  createdAt?: number;
}
export interface SessionArrangement {
  ids: string[];
  createdAt: Record<string, number>;
  manual: boolean;
}
export interface SidebarArrangement {
  version: 1;
  projects: Record<string, SessionArrangement>;
  sessions: Record<string, SessionArrangement>;
}
export function emptyArrangement(): SessionArrangement {
  return { ids: [], createdAt: {}, manual: false };
}
export function validCreatedAt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
export function compareCreated(a: ArrangementItem, b: ArrangementItem): number {
  return (
    (a.createdAt ?? Number.MAX_SAFE_INTEGER) - (b.createdAt ?? Number.MAX_SAFE_INTEGER) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}
export function reconcileArrangement(
  saved: SessionArrangement | undefined,
  items: ArrangementItem[],
  now = Date.now(),
): SessionArrangement {
  const next = structuredClone(saved ?? emptyArrangement());
  for (const item of items) {
    if (!Object.hasOwn(next.createdAt, item.key))
      next.createdAt[item.key] = validCreatedAt(item.createdAt) ? item.createdAt : now;
    if (!next.ids.includes(item.key)) next.ids.push(item.key);
  }
  if (!next.manual)
    next.ids.sort((a, b) =>
      compareCreated(
        { key: a, createdAt: next.createdAt[a] },
        { key: b, createdAt: next.createdAt[b] },
      ),
    );
  return next;
}
export function moveArrangement(
  saved: SessionArrangement,
  from: string,
  to: string,
  placement: 'before' | 'after',
): SessionArrangement {
  if (from === to) return saved;
  if (!saved.ids.includes(from) || !saved.ids.includes(to))
    throw new Error('The ordering target is no longer available.');
  const ids = saved.ids.filter((key) => key !== from);
  ids.splice(ids.indexOf(to) + (placement === 'after' ? 1 : 0), 0, from);
  return { ...saved, ids, manual: true };
}
export function promoteArrangement(
  saved: SessionArrangement,
  draft: string,
  native: string,
): SessionArrangement {
  if (!saved.ids.includes(draft)) return saved;
  const ids = saved.ids
    .filter((key) => key !== native)
    .map((key) => (key === draft ? native : key));
  const createdAt = { ...saved.createdAt, [native]: saved.createdAt[draft] };
  delete createdAt[draft];
  return { ...saved, ids, createdAt };
}
export function validateSidebarArrangement(value: unknown): SidebarArrangement {
  const object = (input: unknown): Record<string, unknown> => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Invalid sidebar arrangement.');
    return input as Record<string, unknown>;
  };
  const raw = object(value);
  if (raw.version !== 1) throw new Error('Unsupported sidebar arrangement version.');
  const groups = (input: unknown) =>
    Object.fromEntries(
      Object.entries(object(input)).map(([scope, data]) => {
        if (!scope || scope.length > 4096) throw new Error('Invalid arrangement scope.');
        const group = object(data);
        if (
          !Array.isArray(group.ids) ||
          group.ids.some((id) => typeof id !== 'string' || !id || id.length > 4096) ||
          new Set(group.ids).size !== group.ids.length ||
          typeof group.manual !== 'boolean'
        )
          throw new Error('Invalid arrangement order.');
        const dates = object(group.createdAt);
        if (
          Object.values(dates).some((time) => !validCreatedAt(time)) ||
          group.ids.some((id) => !Object.hasOwn(dates, id))
        )
          throw new Error('Invalid arrangement creation time.');
        return [
          scope,
          {
            ids: [...group.ids] as string[],
            manual: group.manual,
            createdAt: { ...dates } as Record<string, number>,
          },
        ];
      }),
    );
  const projects = groups(raw.projects),
    sessions = groups(raw.sessions);
  const agents = ['claude', 'codex', 'gemini', 'aider', 'copilot'];
  for (const [agent, group] of Object.entries(projects))
    if (!agents.includes(agent) || group.ids.some((id) => !id.startsWith(`${agent}:`)))
      throw new Error('Invalid project ordering identity.');
  for (const [scope, group] of Object.entries(sessions)) {
    const agent = scope.slice(0, scope.indexOf(':'));
    if (
      !agents.includes(agent) ||
      group.ids.some((id) => !id.startsWith(`${agent}:`) && !/^draft:[a-f0-9-]{36}$/.test(id))
    )
      throw new Error('Invalid session ordering identity.');
  }
  return { version: 1, projects, sessions };
}
