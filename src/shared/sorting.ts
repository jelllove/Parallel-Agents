export const SORT_KEYS = ['created', 'modified', 'name', 'custom'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  created: 'Date created',
  modified: 'Last modified',
  name: 'Name',
  custom: 'Custom order',
};

export interface SortFields<T> {
  name: (item: T) => string;
  created: (item: T) => number | null | undefined;
  modified: (item: T) => number | null | undefined;
}

export function parseSortKey<K extends SortKey>(value: unknown, fallback: K): SortKey {
  return SORT_KEYS.find((key) => key === value) ?? fallback;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function newestFirst(a: number | null | undefined, b: number | null | undefined): number {
  const aMissing = a === null || a === undefined || !Number.isFinite(a);
  const bMissing = b === null || b === undefined || !Number.isFinite(b);
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
  return b - a;
}

export function sortBy<T>(items: readonly T[], key: SortKey, fields: SortFields<T>): T[] {
  if (key === 'custom') return [...items];
  const byName = (a: T, b: T) => collator.compare(fields.name(a), fields.name(b));
  return [...items].sort((a, b) => {
    if (key === 'name') return byName(a, b);
    return newestFirst(fields[key](a), fields[key](b)) || byName(a, b);
  });
}
