import { useAppStore } from '../store/app-store';
import { SessionIcon } from './SessionIcon';

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
  const openTab = useAppStore((s) => s.openTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const openTabs = useAppStore((s) => s.openTabs);
  const project = useAppStore((s) => s.projects.find((p) => p.id === selectedId));

  if (!selectedId) {
    return <div className="list-item-sub" style={{ padding: '4px 12px' }}>Select a project to view its sessions.</div>;
  }

  if (sessions.length === 0) {
    return <div className="list-item-sub" style={{ padding: '4px 12px' }}>No sessions yet.</div>;
  }

  async function resume(sessionId: string) {
    if (!project || !project.exists) return;
    if (!openTabs.includes(project.id)) {
      openTab(project.id);
    } else {
      setActiveTab(project.id);
    }
    // Slight delay so the terminal mounts and spawns before we write.
    setTimeout(() => {
      window.api.pty.write(project.id, `claude --resume ${sessionId}\r`);
    }, 200);
  }

  return (
    <div>
      {sessions.map((s) => (
        <div key={s.id} className="list-item session-item" onClick={() => resume(s.id)} title={s.title}>
          <SessionIcon className="session-icon" />
          <div className="session-text">
            <div className="list-item-title">{s.title || '(empty)'}</div>
            <div className="list-item-sub">{formatTime(s.timestamp)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
