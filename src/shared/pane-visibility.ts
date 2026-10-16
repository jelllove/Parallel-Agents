import type { LayoutConfig, PaneId } from './types.ts';

export type SidePaneId = 'sidebar' | 'right';

export function togglePane(layout: LayoutConfig, pane: SidePaneId): LayoutConfig {
  if (pane !== 'sidebar' && pane !== 'right') throw new Error('Only a side pane can be hidden.');
  const hidden = new Set(layout.hiddenPanes ?? []);
  if (hidden.has(pane)) hidden.delete(pane);
  else hidden.add(pane);
  return { ...layout, hiddenPanes: (['sidebar', 'right'] as const).filter((id) => hidden.has(id)) };
}

export function toggleFocus(layout: LayoutConfig): LayoutConfig {
  const hidden = layout.hiddenPanes ?? [];
  return {
    ...layout,
    hiddenPanes: hidden.includes('sidebar') && hidden.includes('right') ? [] : ['sidebar', 'right'],
  };
}

export function projectedPanelSizes(layout: LayoutConfig): [number, number, number] {
  const hidden = layout.hiddenPanes ?? [];
  const sizes = layout.order.map((id, index) =>
    hidden.some((pane) => pane === id) ? 0 : layout.sizes[index],
  );
  const middle = layout.order.indexOf('middle');
  sizes[middle] += 100 - sizes.reduce((total, size) => total + size, 0);
  return [sizes[0], sizes[1], sizes[2]];
}

export function visiblePaneBefore(order: PaneId[], index: number, hidden: SidePaneId[]): boolean {
  return (
    !hidden.some((id) => id === order[index]) &&
    order.slice(index + 1).some((id) => !hidden.some((pane) => pane === id))
  );
}
