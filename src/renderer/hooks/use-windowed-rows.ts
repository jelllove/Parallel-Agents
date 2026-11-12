import { useEffect, useRef, useState } from 'react';
import { windowedRows } from '../windowed-rows';

/** A large session group shares the sidebar's scroll owner; data/controllers stay mounted. */
export function useWindowedRows(keys: string[], activeKey?: string, forceAll = false) {
  const root = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const [viewport, setViewport] = useState({ top: 0, bottom: 800, estimate: 50 });
  const [focused, setFocused] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const signature = keys.join('\0');
  const enabled = keys.length >= 100 && !forceAll && !dragging;
  useEffect(() => {
    const node = root.current;
    if (!node || !enabled) return;
    const scroll = node.closest('.sidebar-section.scrollable');
    if (!scroll) return;
    let frame: number | null = null;
    const update = () => {
      frame = null;
      const area = scroll.getBoundingClientRect();
      const bounds = node.getBoundingClientRect();
      const sample = node.querySelector('[data-virtual-key]');
      const estimate = sample?.getBoundingClientRect().height || 50;
      const fontKey = getComputedStyle(node).fontSize;
      if (node.dataset.virtualFont !== fontKey) {
        heights.current.clear();
        node.dataset.virtualFont = fontKey;
      }
      for (const row of node.querySelectorAll<HTMLElement>('[data-virtual-key]')) {
        const height = row.getBoundingClientRect().height;
        if (height > 0) heights.current.set(row.dataset.virtualKey!, height);
      }
      const top = area.top - bounds.top - 250;
      const bottom = area.bottom - bounds.top + 250;
      setViewport((previous) =>
        previous.top === top && previous.bottom === bottom && previous.estimate === estimate
          ? previous
          : { top, bottom, estimate },
      );
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
    observer.observe(node);
    scroll.addEventListener('scroll', schedule, { passive: true });
    update();
    return () => {
      observer.disconnect();
      scroll.removeEventListener('scroll', schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [signature, enabled]);
  useEffect(() => {
    const node = root.current;
    if (!node || !enabled) return;
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.virtualKey;
        const height = entry.target.getBoundingClientRect().height;
        if (key && height > 0 && heights.current.get(key) !== height) {
          heights.current.set(key, height);
          changed = true;
        }
      }
      if (changed) setViewport((previous) => ({ ...previous }));
    });
    for (const row of node.querySelectorAll('[data-virtual-key]')) observer.observe(row);
    return () => observer.disconnect();
  });
  useEffect(() => {
    const existing = new Set(keys);
    for (const key of heights.current.keys()) if (!existing.has(key)) heights.current.delete(key);
  }, [signature]);
  const rows = windowedRows(
    keys,
    heights.current,
    enabled ? viewport.top : -Infinity,
    enabled ? viewport.bottom : Infinity,
    [activeKey, focused].filter((key): key is string => Boolean(key)),
    viewport.estimate,
  );
  return { root, rows, setFocused, setDragging };
}
