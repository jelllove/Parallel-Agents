import { useEffect } from 'react';
import { useAppStore } from '../store/app-store';

interface Props {
  anchorRect: DOMRect;
  onClose: () => void;
}

export function SettingsPicker({ anchorRect, onClose }: Props) {
  const confirmOnCloseTab = useAppStore((s) => s.confirmOnCloseTab);
  const terminalMultilineEnter = useAppStore((s) => s.terminalMultilineEnter);
  const terminalCopyPaste = useAppStore((s) => s.terminalCopyPaste);
  const setConfirmOnCloseTab = useAppStore((s) => s.setConfirmOnCloseTab);
  const setTerminalMultilineEnter = useAppStore((s) => s.setTerminalMultilineEnter);
  const setTerminalCopyPaste = useAppStore((s) => s.setTerminalCopyPaste);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const top = Math.max(8, anchorRect.top - 200);
  const right = Math.max(8, window.innerWidth - anchorRect.right);

  return (
    <>
      <div className="layout-picker-backdrop" onClick={onClose} />
      <div
        className="layout-picker settings-picker"
        style={{ top, right }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="layout-picker-title">Settings</div>
        <label className="settings-row">
          <input
            type="checkbox"
            checked={confirmOnCloseTab}
            onChange={(e) => void setConfirmOnCloseTab(e.target.checked)}
          />
          <span>Confirm before closing a tab</span>
        </label>
        <label className="settings-row">
          <input
            type="checkbox"
            checked={terminalMultilineEnter}
            onChange={(e) => void setTerminalMultilineEnter(e.target.checked)}
          />
          <span>Shift+Enter / Ctrl+Enter inserts newline in terminal</span>
        </label>
        <label className="settings-row">
          <input
            type="checkbox"
            checked={terminalCopyPaste}
            onChange={(e) => void setTerminalCopyPaste(e.target.checked)}
          />
          <span>Ctrl+C / Ctrl+V copy/paste + right-click menu in terminal</span>
        </label>
      </div>
    </>
  );
}
