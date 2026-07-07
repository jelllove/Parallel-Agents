import { useEffect } from 'react';
import { ClaudeIcon } from './ClaudeIcon';

interface Props {
  onClose: () => void;
}

export function AboutDialog({ onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <ClaudeIcon size={20} />
          <span>About Parallel Agents</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p className="about-tagline">
            One window for all your CLI coding agents — Claude Code, Codex, Gemini CLI, and more.
          </p>
          <dl className="about-meta">
            <dt>Version</dt>
            <dd>0.1.0</dd>
            <dt>Author</dt>
            <dd>jelllove</dd>
            <dt>Email</dt>
            <dd>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  window.api.shell?.openExternal('mailto:jelllove@gmail.com');
                }}
              >jelllove@gmail.com</a>
            </dd>
            <dt>Built with</dt>
            <dd>Electron · React · xterm.js · node-pty</dd>
          </dl>
          <p className="about-footer">
            Run multiple agent sessions side by side, without losing context.
          </p>
        </div>
      </div>
    </div>
  );
}
