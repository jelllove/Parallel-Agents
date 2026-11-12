export interface WindowedRow {
  key: string;
  index: number;
  top: number;
  height: number;
  visible: boolean;
}
/** Precompute offsets once; pin focus neighbors so keyboard traversal cannot skip an unmounted row. */
export function windowedRows(
  keys: string[],
  heights: Map<string, number>,
  top: number,
  bottom: number,
  pinned: string[],
  estimate = 50,
): WindowedRow[] {
  const indices = new Set<number>();
  for (const key of pinned) {
    const i = keys.indexOf(key);
    if (i >= 0) for (const offset of [-1, 0, 1]) indices.add(i + offset);
  }
  let offset = 0;
  return keys.map((key, index) => {
    const height = heights.get(key) ?? estimate;
    const start = offset;
    offset += height;
    return {
      key,
      index,
      top: start,
      height,
      visible: indices.has(index) || (offset >= top && start <= bottom),
    };
  });
}
