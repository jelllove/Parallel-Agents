import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  message: ReactNode;
  confirmText: string;
  typeToConfirm?: string;
  destructive?: boolean;
  warning?: string;
  confirmDisabled?: boolean;
  armed?: boolean;
  onArmedChange?: (armed: boolean) => void;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmText,
  typeToConfirm,
  destructive,
  warning,
  confirmDisabled,
  armed: controlledArmed,
  onArmedChange,
  onConfirm,
  onCancel,
}: Props) {
  const [input, setInput] = useState('');
  const [localArmed, setLocalArmed] = useState(false);
  const armed = controlledArmed ?? localArmed;
  const inputRef = useRef<HTMLInputElement>(null);
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (typeToConfirm === undefined ? checkboxRef : inputRef).current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, typeToConfirm]);

  const canConfirm =
    (typeToConfirm === undefined || input === typeToConfirm) && armed && !confirmDisabled;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="modal-body">
          <div>{message}</div>
          {typeToConfirm !== undefined && (
            <>
              <div
                style={{
                  marginTop: 12,
                  fontSize: 'calc(var(--app-font-size) * 0.923077)',
                  color: 'var(--text-dim)',
                }}
              >
                Type <code>{typeToConfirm}</code> to enable the {confirmText} button:
              </div>
              <input
                ref={inputRef}
                className="modal-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={typeToConfirm}
              />
            </>
          )}
          <label className="modal-check">
            <input
              ref={checkboxRef}
              type="checkbox"
              checked={armed}
              onChange={(e) => {
                setLocalArmed(e.target.checked);
                onArmedChange?.(e.target.checked);
              }}
            />
            <span>I understand this cannot be undone.</span>
          </label>
          {warning && (
            <div className="modal-warn" role="alert">
              {warning}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={destructive ? 'btn-danger' : 'btn-primary'}
            disabled={!canConfirm}
            onClick={() => {
              if (canConfirm) void onConfirm();
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
