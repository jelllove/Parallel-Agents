import { useEffect, useRef, useState } from 'react';
import { ACTIVITY_ICON, ACTIVITY_LABEL } from '../../shared/session-activity';

export function AgentStatusHooksDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<Awaited<
    ReturnType<typeof window.api.activity.codexStatus>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    void window.api.activity
      .codexStatus()
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="workflow-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2>Agent status hooks</h2>
      <p>
        Claude Code and Copilot receive passive launch-only hooks when their installed CLI supports
        them. Existing hooks, approvals and authentication are unchanged.
      </p>
      <p>
        ○ means this history has no linked tab open in this window. Inactive open tabs keep their
        activity icon.
      </p>
      <ul>
        {Object.entries(ACTIVITY_ICON).map(([state, icon]) => (
          <li key={state}>
            {icon} {ACTIVITY_LABEL[state as keyof typeof ACTIVITY_LABEL]}
          </li>
        ))}
      </ul>
      <p>
        Codex needs additive user hooks and its own /hooks trust confirmation. Status stays unknown
        when hooks are disabled, untrusted or unsupported. Only sessions launched by this app report
        activity.
      </p>
      {status && (
        <>
          <p>
            {status.installed ? 'Codex status hooks installed' : 'Codex status hooks not installed'}
          </p>
          <code className="hook-config-path">{status.path}</code>
        </>
      )}
      {error && (
        <p role="alert" className="inventory-error">
          {error}
        </p>
      )}
      <div className="workflow-actions">
        <button className="btn-secondary" disabled={busy} onClick={onClose}>
          Close
        </button>
        <button
          className="btn-primary"
          disabled={busy || !status}
          onClick={async () => {
            if (!status || busy) return;
            setBusy(true);
            setError('');
            try {
              setStatus(await window.api.activity.configureCodex(!status.installed, status.digest));
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? 'Updating...'
            : status?.installed
              ? 'Remove Codex status hooks'
              : 'Add Codex status hooks'}
        </button>
      </div>
    </dialog>
  );
}
