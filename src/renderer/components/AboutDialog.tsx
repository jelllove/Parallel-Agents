import { useEffect, useState } from 'react';
import { ClaudeIcon } from './ClaudeIcon';
import { useUpdateStatus } from '../hooks/use-update-status';

interface Props {
  onClose: () => void;
}

export function AboutDialog({ onClose }: Props) {
  const { update, updateError, pending, runUpdateAction } = useUpdateStatus();
  const [linkError, setLinkError] = useState<string | null>(null);

  async function openLink(url: string) {
    setLinkError(null);
    try {
      await window.api.shell.openExternal(url);
    } catch (error) {
      setLinkError(
        `Could not open link: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <ClaudeIcon size={20} />
          <span id="about-title">About Parallel Agents</span>
          <button className="modal-close" onClick={onClose} aria-label="Close About">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="about-tagline">
            One window for all your CLI coding agents — Claude Code, Codex, Gemini CLI, and more.
          </p>
          <dl className="about-meta">
            <dt>Version</dt>
            <dd>{__APP_BUILD_INFO__.version}</dd>
            <dt>Commit</dt>
            <dd title={__APP_BUILD_INFO__.commit ?? undefined}>
              <code>
                {__APP_BUILD_INFO__.commit?.slice(0, 12) ?? 'Unavailable (source archive)'}
              </code>
              {__APP_BUILD_INFO__.dirty && <span> (uncommitted changes)</span>}
            </dd>
            <dt>Author</dt>
            <dd>jelllove</dd>
            <dt>Website</dt>
            <dd>
              <a
                href="http://www.jelllove.com"
                onClick={(event) => {
                  event.preventDefault();
                  return openLink('http://www.jelllove.com');
                }}
              >
                www.jelllove.com
              </a>
            </dd>
            <dt>Email</dt>
            <dd>
              <a
                href="mailto:jelllove@gmail.com"
                onClick={(e) => {
                  e.preventDefault();
                  return openLink('mailto:jelllove@gmail.com');
                }}
              >
                jelllove@gmail.com
              </a>
            </dd>
            <dt>Built with</dt>
            <dd>Electron · React · xterm.js · node-pty</dd>
          </dl>
          {linkError && (
            <p role="alert" style={{ overflowWrap: 'anywhere' }}>
              {linkError}
            </p>
          )}
          <section className="about-updates" aria-label="Application updates">
            <h3>Updates</h3>
            <p className="about-installed-version">
              Installed version: {__APP_BUILD_INFO__.version}
            </p>
            <p role="status" aria-live="polite">
              {!update && !updateError && 'Loading update status…'}
              {update?.state === 'unavailable' && update.message}
              {update?.state === 'idle' &&
                (update.message ?? 'Updates are checked automatically every 4 hours.')}
              {update?.state === 'checking' && 'Checking GitHub releases…'}
              {update?.state === 'available' && `Downloading version ${update.version}…`}
              {update?.state === 'downloading' &&
                `Downloading version ${update.version}: ${Math.round(update.percent ?? 0)}%`}
              {update?.state === 'downloaded' && `Version ${update.version} is ready to install.`}
              {update?.state === 'installing' && 'Installing update and restarting…'}
            </p>
            {update?.state === 'unavailable' && (
              <p>
                Updates for this installation are manual. Open the latest release and download the
                package for your operating system and architecture.
              </p>
            )}
            {update?.state === 'downloading' && (
              <progress
                aria-label="Update download progress"
                max={100}
                value={update.percent ?? 0}
              />
            )}
            {(updateError || update?.state === 'error') && (
              <p role="alert" style={{ overflowWrap: 'anywhere' }}>
                {updateError ?? update?.message}
              </p>
            )}
            {updateError && (
              <button
                className="btn-secondary"
                disabled={pending}
                onClick={() => runUpdateAction('getStatus')}
              >
                Retry update status
              </button>
            )}
            <div className="about-update-actions">
              <button
                className="btn-secondary"
                disabled={
                  !update ||
                  pending ||
                  update.state === 'unavailable' ||
                  update.canInstall ||
                  ['checking', 'available', 'downloading', 'installing'].includes(update.state)
                }
                onClick={() => runUpdateAction('check')}
              >
                Check for updates
              </button>
              {update?.canInstall && (
                <button
                  className="btn-primary"
                  disabled={pending || update.state === 'installing'}
                  onClick={() => runUpdateAction('install')}
                >
                  Restart to update
                </button>
              )}
              <a
                className="about-release-link"
                href="https://github.com/jelllove/Parallel-Agents/releases/latest"
                onClick={(event) => {
                  event.preventDefault();
                  return openLink('https://github.com/jelllove/Parallel-Agents/releases/latest');
                }}
              >
                View latest release / manual download
              </a>
            </div>
            {update && update.state !== 'unavailable' && (
              <p>
                Updates download in the background. Agents are stopped only when you confirm a
                restart; quitting normally does not install updates.
              </p>
            )}
          </section>
          <p className="about-footer">
            Run multiple agent sessions side by side, without losing context.
          </p>
        </div>
      </div>
    </div>
  );
}
