import { SORT_LABELS, type SortKey } from '../../shared/sorting';
import type { SortPanel } from '../../shared/types';
import { useAppStore } from '../store/app-store';

export function SortPicker({ panel, keys }: { panel: SortPanel; keys: readonly SortKey[] }) {
  const value = useAppStore((s) => s.sortOrders[panel]);
  const setSortOrder = useAppStore((s) => s.setSortOrder);
  return (
    <label className="sort-picker" title="Sort order" onClick={(e) => e.stopPropagation()}>
      <span className="sort-picker-label">Sort</span>
      <select
        aria-label={`Sort ${panel}`}
        value={value}
        onChange={(e) => void setSortOrder(panel, e.target.value as SortKey)}
      >
        {keys.map((key) => (
          <option key={key} value={key}>
            {SORT_LABELS[key]}
          </option>
        ))}
      </select>
    </label>
  );
}
