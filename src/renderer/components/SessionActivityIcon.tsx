import { ACTIVITY_ICON, ACTIVITY_LABEL } from '../../shared/session-activity';
import type { ActivityState } from '../../shared/session-activity';

interface Props {
  state?: ActivityState;
  attention?: boolean;
  onAcknowledge?: () => void;
}
export function SessionActivityIcon({
  state = 'unknown',
  attention = false,
  onAcknowledge,
}: Props) {
  const pending = state === 'completed' && attention;
  const label =
    ACTIVITY_LABEL[state] +
    (state === 'completed' ? (pending ? ' — not yet acknowledged' : ' — acknowledged') : '');
  const className = `session-activity-icon ${state}${pending ? ' needs-attention' : ''}`;
  const glyph = (
    <span className="session-activity-glyph" aria-hidden="true">
      {ACTIVITY_ICON[state]}
    </span>
  );
  if (pending && onAcknowledge) {
    return (
      <button
        type="button"
        className={className}
        aria-label={`Acknowledge completion: ${label}`}
        title={`Acknowledge completion: ${label}`}
        onClick={(event) => {
          event.stopPropagation();
          onAcknowledge();
        }}
      >
        {glyph}
      </button>
    );
  }
  return (
    <span className={className} role="img" aria-label={label} title={label}>
      {glyph}
    </span>
  );
}
