/** Reuse unchanged transport snapshots so unrelated views do not render on every poll. */
export function reconcileRecords<T extends { id: string }>(previous: T[], incoming: T[]): T[] {
  const byId = new Map(previous.map((item) => [item.id, item]));
  const next = incoming.map((item) => {
    const old = byId.get(item.id);
    return old && JSON.stringify(old) === JSON.stringify(item) ? old : item;
  });
  return next.length === previous.length && next.every((item, index) => item === previous[index])
    ? previous
    : next;
}
