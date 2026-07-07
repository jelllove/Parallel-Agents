import { useState } from 'react';
import { useAppStore } from '../store/app-store';
import { agentIconUrl, resumeCommandFor, extraPathFor } from '../icons/agentIcons';
import { ConfirmDialog } from './ConfirmDialog';
import type { Session } from '../../shared/types';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = (now.getTime() - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

export function SessionList() {
  const selectedId = useAppStore((s) => s.selectedProjectId);
  const sessions = useAppStore((s) => (selectedId ? s.sessions[selectedId] ?? [] : []));
  const restartTabWithCommand = useAppStore((s) => s.restartTabWithCommand);
  const project = useAppStore((s) => s.projects.find((p) => p.id === selectedId));
  const status = useAppStore((s) => s.agentStatus);
  const deleteSession = useAppStore((s) => s.deleteSession);

  const [confirmDelete, setConfirmDelete] = useState<Session | null>(null);

  if (!selectedId) {
    return <div className="list-item-sub" style={{ padding: '4px 12px' }}>Select a project to view its sessions.</div>;
  }

  if (sessions.length === 0) {
    return <div className="list-item-sub" style={{ padding: '4px 12px' }}>No sessions yet.</div>;
  }

  async function resume(s: Session) {
    if (!project || !project.exists) return;
    const cmd = resumeCommandFor(s.agent, s.id);
    if (!cmd) return;
    await restartTabWithCommand(project.id, s.agent, cmd, extraPathFor(status[s.agent]?.path));
  }

  return (
    <div>
      {sessions.map((s) => {
        const cmd = resumeCommandFor(s.agent, s.id);
        return (
          <div
            key={s.id}
            className={`list-item session-item${cmd ? '' : ' disabled'}`}
            onClick={() => resume(s)}
            title={cmd ? `${s.title}\n${cmd}` : `${s.title}\n(no resume available for ${s.agent})`}
          >
            <img src={agentIconUrl(s.agent)} className="session-icon" alt="" draggable={false} />
            <div className="session-text">
              <div className="list-item-title">{s.title || '(empty)'}</div>
              <div className="list-item-sub">{formatTime(s.timestamp)}</div>
            </div>
            <button
              className="session-delete"
              title="Delete this session"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(s);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete session?"
          message={`This will permanently delete the session file for "${confirmDelete.title || '(empty)'}". This cannot be undone.`}
          confirmText="Delete forever"
          typeToConfirm="delete"
          destructive
          onConfirm={async () => {
            const s = confirmDelete;
            setConfirmDelete(null);
            if (selectedId) await deleteSession(selectedId, s.id);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
