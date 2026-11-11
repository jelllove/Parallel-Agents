import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AgentId, AgentInfo, AgentStatus } from '../../shared/types';
import { AgentIcon } from './AgentIcon';
import { useAppStore } from '../store/app-store';

interface Props {
  agents: AgentInfo[];
  status: Record<AgentId, AgentStatus>;
  onPick: (agentId: AgentId) => void;
  onClose: () => void;
  anchorX: number;
  anchorY: number;
  title?: string;
}

export function AgentPicker({ agents, status, onPick, onClose, anchorX, anchorY, title }: Props) {
  const showAgentLaunchSettings = useAppStore((s) => s.showAgentLaunchSettings);
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: anchorX, y: anchorY });

  useLayoutEffect(() => {
    const popup = popupRef.current;
    if (!popup) return;
    const place = () => {
      const { width, height } = popup.getBoundingClientRect();
      const x = Math.max(8, Math.min(anchorX, window.innerWidth - width - 8));
      const y = Math.max(8, Math.min(anchorY, window.innerHeight - height - 8));
      setPos((previous) => (previous.x === x && previous.y === y ? previous : { x, y }));
    };
    const observer = new ResizeObserver(place);
    observer.observe(popup);
    window.addEventListener('resize', place);
    place();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchorX, anchorY]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <>
      <div className="agent-picker-backdrop" onClick={onClose} />
      <div
        ref={popupRef}
        className="agent-picker"
        role="region"
        aria-label={title ?? 'Choose an agent'}
        style={{ left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <div className="agent-picker-title">{title}</div>}
        {agents.map((a) => {
          const st = status[a.id];
          const available = st?.available ?? false;
          return (
            <div
              key={a.id}
              className={`agent-picker-row${available ? '' : ' unavailable'}`}
              title={
                available ? a.displayName : `${a.displayName} not installed — ${a.installHint}`
              }
            >
              <AgentIcon agent={a.id} className="agent-picker-icon" size={22} />
              <div className="agent-picker-text">
                <div className="agent-picker-name">{a.displayName}</div>
                <div
                  className="agent-picker-sub"
                  title={available ? (st?.path ?? 'installed') : a.installHint}
                >
                  {available ? st?.path || 'installed' : 'not installed'}
                </div>
              </div>
              <div className="agent-picker-actions">
                <button
                  type="button"
                  className="btn-secondary agent-picker-new"
                  aria-label={`New project with ${a.displayName}`}
                  title={
                    available
                      ? `Create a session with ${a.displayName}`
                      : `${a.displayName} is not installed`
                  }
                  disabled={!available}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (available) onPick(a.id);
                  }}
                >
                  New
                </button>
                <button
                  type="button"
                  className="btn-secondary agent-launch-configure"
                  aria-label={`Configure ${a.displayName} launch`}
                  title="Configure this agent's approval mode and model"
                  onClick={(event) => {
                    event.stopPropagation();
                    showAgentLaunchSettings(a.id);
                  }}
                >
                  Options
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
