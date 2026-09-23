import type { SessionActivity } from '../../shared/session-activity';

const LABELS: Record<SessionActivity, string> = {
  running: 'Agent is working',
  waiting: 'Agent is waiting for your input',
  done: 'Agent finished its task',
};

export function ActivityBadge({ state }: { state: SessionActivity | null }) {
  if (!state) return null;
  return (
    <span className={`activity-badge activity-${state}`} title={LABELS[state]} role="status">
      {state === 'running' ? (
        <span className="activity-spinner" aria-label={LABELS[state]} />
      ) : (
        <span aria-label={LABELS[state]}>{state === 'waiting' ? '❓' : '✅'}</span>
      )}
    </span>
  );
}
