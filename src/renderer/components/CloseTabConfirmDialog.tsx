import { useEffect, useRef, useState } from 'react';

interface Props {
  projectName: string;
  onConfirm: (dontAskAgain: boolean) => void;
  onCancel: () => void;
}

export function CloseTabConfirmDialog({ projectName, onConfirm, onCancel }: Props) {
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmBtnRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') onConfirm(dontAskAgain);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm, dontAskAgain]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Close this tab?</div>
        <div className="modal-body">
          <div>
            The tab <b>"{projectName}"</b> will be closed. Any running CLI process in this tab will
            also stop.
          </div>
          <label className="modal-check" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
            />
            <span>Don't ask again</span>
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={confirmBtnRef}
            className="btn-primary"
            onClick={() => onConfirm(dontAskAgain)}
          >
            Close tab
          </button>
        </div>
      </div>
    </div>
  );
}
