import { useEffect, useState } from 'react';
import { ActionIcon } from './ActionIcon';

interface SessionDrag {
  scope: string;
  key: string;
}
export let activeSessionDrag: SessionDrag | null = null;
interface Props {
  rowKey: string;
  scope: string;
  label: string;
  disabled: boolean;
  previous?: string;
  next?: string;
  onMove: (from: string, to: string, placement: 'before' | 'after') => Promise<void>;
  onDragFinished: () => void;
}
export function SessionOrderControls({
  rowKey,
  scope,
  label,
  disabled,
  previous,
  next,
  onMove,
  onDragFinished,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);
  const move = (direction: -1 | 1) => {
    const target = direction < 0 ? previous : next;
    if (!disabled && target) void onMove(rowKey, target, direction < 0 ? 'before' : 'after');
  };
  return (
    <>
      <button
        type="button"
        className="session-order-handle"
        aria-label={`Move session ${label}`}
        title="Drag to reorder · Alt+Up/Down · Right-click for moves"
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        disabled={disabled}
        draggable={!disabled}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            move(event.key === 'ArrowUp' ? -1 : 1);
          }
        }}
        onDragStart={(event) => {
          event.stopPropagation();
          activeSessionDrag = { scope, key: rowKey };
          event.dataTransfer.setData(
            'application/x-parallel-agents-session',
            JSON.stringify({ scope, key: rowKey }),
          );
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={(event) => {
          event.stopPropagation();
          activeSessionDrag = null;
          onDragFinished();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <ActionIcon name="grip" />
      </button>
      {menu && (
        <div
          className="ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="ctx-menu-item"
            disabled={disabled || !previous}
            onClick={() => {
              setMenu(null);
              move(-1);
            }}
          >
            Move up
          </button>
          <button
            type="button"
            className="ctx-menu-item"
            disabled={disabled || !next}
            onClick={() => {
              setMenu(null);
              move(1);
            }}
          >
            Move down
          </button>
        </div>
      )}
    </>
  );
}
