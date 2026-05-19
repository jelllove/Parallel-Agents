import { useAppStore } from '../store/app-store';

const INSTALL_DOCS = 'https://docs.claude.com/claude-code';

export function ClaudeMissingBanner() {
  const status = useAppStore((s) => s.claudeStatus);
  const recheck = useAppStore((s) => s.checkClaude);

  if (status !== 'missing') return null;

  function openDocs() {
    if (window.api.shell?.openExternal) {
      window.api.shell.openExternal(INSTALL_DOCS);
    }
  }

  return (
    <div className="claude-missing">
      <span className="cm-icon">⚠</span>
      <span className="cm-text">
        <b>Claude CLI not found in PATH.</b> Install it first, then click Re-check.
      </span>
      <button className="cm-btn primary" onClick={openDocs}>
        Open install guide
      </button>
      <button className="cm-btn" onClick={() => recheck()}>
        Re-check
      </button>
    </div>
  );
}
