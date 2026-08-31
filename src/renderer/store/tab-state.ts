export interface TabState {
  openTabs: string[];
  activeTabId: string | null;
}

export function omitRecordKeys<T>(
  record: Record<string, T>,
  keys: string[],
): Record<string, T> {
  const next = { ...record };
  for (const key of keys) delete next[key];
  return next;
}

export function closeTabIds(
  openTabs: string[],
  activeTabId: string | null,
  ids: string[],
): TabState {
  const closing = new Set(ids);
  const next = openTabs.filter((id) => !closing.has(id));
  if (!activeTabId || !closing.has(activeTabId)) {
    return { openTabs: next, activeTabId };
  }

  const activeIndex = openTabs.indexOf(activeTabId);
  return {
    openTabs: next,
    activeTabId: next.find((id) => openTabs.indexOf(id) > activeIndex)
      ?? [...next].reverse().find((id) => openTabs.indexOf(id) < activeIndex)
      ?? null,
  };
}
