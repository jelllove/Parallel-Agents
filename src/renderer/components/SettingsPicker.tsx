import { useEffect, useState } from 'react';
import { AgentStatusHooksDialog } from './AgentStatusHooksDialog';
import { useAppStore } from '../store/app-store';

interface Props {
  anchorRect: DOMRect;
  onClose: () => void;
}

export function SettingsPicker({ anchorRect, onClose }: Props) {
  const [hooksOpen, setHooksOpen] = useState(false);
  const showAgentLaunchSettings = useAppStore((s) => s.showAgentLaunchSettings);
  const clipboardKeys =
    window.api.platform === 'darwin'
      ? 'Command+C / Command+V'
      : window.api.platform === 'linux'
        ? 'Ctrl+Shift+C / Ctrl+Shift+V'
        : 'Ctrl+C / Ctrl+V';
  const confirmOnCloseTab = useAppStore((s) => s.confirmOnCloseTab);
  const terminalMultilineEnter = useAppStore((s) => s.terminalMultilineEnter);
  const terminalCopyPaste = useAppStore((s) => s.terminalCopyPaste);
  const setConfirmOnCloseTab = useAppStore((s) => s.setConfirmOnCloseTab);
  const setTerminalMultilineEnter = useAppStore((s) => s.setTerminalMultilineEnter);
  const setTerminalCopyPaste = useAppStore((s) => s.setTerminalCopyPaste);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !hooksOpen) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, hooksOpen]);

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
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            showAgentLaunchSettings('copilot');
            onClose();
          }}
        >
          Agent approval modes and models...
        </button>
        <button type="button" className="btn-secondary" onClick={() => setHooksOpen(true)}>
          Agent status hooks...
        </button>
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
          <span>
            Shift+Enter / {window.api.platform === 'darwin' ? 'Command' : 'Ctrl'}+Enter inserts
            newline in terminal
          </span>
        </label>
        <label className="settings-row">
          <input
            type="checkbox"
            checked={terminalCopyPaste}
            onChange={(e) => void setTerminalCopyPaste(e.target.checked)}
          />
          <span>{clipboardKeys} copy/paste + right-click menu in terminal</span>
        </label>
      </div>
      {hooksOpen && (
        <AgentStatusHooksDialog
          onClose={() => {
            setHooksOpen(false);
            onClose();
          }}
        />
      )}
    </>
  );
}
