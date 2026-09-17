import { useAppStore } from '../store/app-store';
import { agentIconUrl } from '../icons/agentIcons';

export function AgentsBanner() {
  const agents = useAppStore((s) => s.agents);
  const status = useAppStore((s) => s.agentStatus);
  const recheck = useAppStore((s) => s.checkAgents);

  if (!agents.length) return null;
  const allAvailable = agents.every((a) => status[a.id]?.available);
  if (allAvailable) return null;

  return (
    <div className="agents-banner">
      <span className="ab-label">CLIs:</span>
      {agents.map((a) => {
        const st = status[a.id];
        const ok = st?.available;
        return (
          <button
            key={a.id}
            className={`ab-chip${ok ? ' ok' : ' missing'}`}
            onClick={() => {
              if (!ok && window.api.shell?.openExternal) {
                window.api.shell.openExternal(a.installUrl);
              }
            }}
            title={ok ? (st.path ?? a.displayName) : `Install: ${a.installHint}`}
          >
            <img src={agentIconUrl(a.id)} className="ab-icon" alt="" draggable={false} />
            <span className="ab-name">{a.displayName}</span>
            <span className="ab-status">{ok ? '✓' : '⚠'}</span>
          </button>
        );
      })}
      <button className="ab-recheck" onClick={() => recheck()}>
        Re-check
      </button>
    </div>
  );
}
