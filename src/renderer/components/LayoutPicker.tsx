import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/app-store';
import type { PaneId, LayoutConfig } from '../../shared/types';

const ALL_ORDERS: [PaneId, PaneId, PaneId][] = [
  ['sidebar', 'middle', 'right'],
  ['sidebar', 'right', 'middle'],
  ['middle', 'sidebar', 'right'],
  ['middle', 'right', 'sidebar'],
  ['right', 'sidebar', 'middle'],
  ['right', 'middle', 'sidebar'],
];

const PANE_META: Record<PaneId, { label: string; color: string; letter: string }> = {
  sidebar: { label: 'Sidebar', color: '#1f6feb', letter: 'S' },
  middle: { label: 'Terminal', color: '#16a34a', letter: 'T' },
  right: { label: 'Explorer', color: '#d97706', letter: 'E' },
};

interface Props {
  anchorRect: DOMRect;
  onClose: () => void;
}

function ordersEqual(a: [PaneId, PaneId, PaneId], b: [PaneId, PaneId, PaneId]) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function LayoutPicker({ anchorRect, onClose }: Props) {
  const layout = useAppStore((s) => s.layout);
  const setLayoutAction = useAppStore((s) => s.setLayout);
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 240, h: 280 });

  useEffect(() => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    }
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const currentOrder = layout?.order ?? ['sidebar', 'middle', 'right'];
  const currentSizes = layout?.sizes ?? [20, 58, 22];

  const top = Math.max(8, anchorRect.top - size.h - 6);
  const left = Math.max(8, Math.min(window.innerWidth - size.w - 8, anchorRect.right - size.w));

  function pick(newOrder: [PaneId, PaneId, PaneId]) {
    if (ordersEqual(newOrder, currentOrder)) {
      onClose();
      return;
    }
    const reorderedSizes: [number, number, number] = [
      currentSizes[currentOrder.indexOf(newOrder[0])],
      currentSizes[currentOrder.indexOf(newOrder[1])],
      currentSizes[currentOrder.indexOf(newOrder[2])],
    ];
    const next: LayoutConfig = { order: newOrder, sizes: reorderedSizes };
    void setLayoutAction(next);
    onClose();
  }

  const rows = useMemo(
    () =>
      ALL_ORDERS.map((order) => ({
        order,
        active: ordersEqual(order, currentOrder as [PaneId, PaneId, PaneId]),
      })),
    [currentOrder],
  );

  return (
    <>
      <div className="layout-picker-backdrop" onClick={onClose} />
      <div
        className="layout-picker"
        ref={ref}
        style={{ top, left }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="layout-picker-title">Window Layout</div>
        {rows.map(({ order, active }) => (
          <button
            key={order.join('-')}
            className={`layout-row${active ? ' active' : ''}`}
            onClick={() => pick(order)}
          >
            <span className="layout-cells">
              {order.map((pid, i) => (
                <span key={i} className="layout-cell" style={{ background: PANE_META[pid].color }}>
                  {PANE_META[pid].letter}
                </span>
              ))}
            </span>
            <span className="layout-label">
              {order.map((pid) => PANE_META[pid].label).join(' · ')}
            </span>
            {active && <span className="layout-check">✓</span>}
          </button>
        ))}
      </div>
    </>
  );
}
