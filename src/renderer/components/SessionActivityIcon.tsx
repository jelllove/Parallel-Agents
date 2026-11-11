import { ACTIVITY_ICON, ACTIVITY_LABEL } from '../../shared/session-activity';
import type { ActivityState } from '../../shared/session-activity';

interface Props {
  isOpen?: boolean;
  state?: ActivityState;
  attention?: boolean;
  onAcknowledge?: () => void;
}
export function SessionActivityIcon({
  isOpen = true,
  state = 'unknown',
  attention = false,
  onAcknowledge,
}: Props) {
  if (!isOpen) {
    return (
      <span
        className="session-activity-icon not-open"
        role="img"
        aria-label="Not open in this window"
        title="Not open in this window"
      >
        <span className="session-activity-glyph" aria-hidden="true">
          ○
        </span>
      </span>
    );
  }
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
