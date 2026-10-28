import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../shared/types';
import { ClaudeIcon } from './ClaudeIcon';

export function AppHeader({ fullscreen }: { fullscreen: boolean }) {
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const unsubscribe = window.api.updates.onStatus((status) => {
      receivedEvent = true;
      if (active) {
        setUpdate(status);
        setError(null);
      }
    });
    window.api.updates
      .getStatus()
      .then((status) => {
        if (active && !receivedEvent) setUpdate(status);
      })
      .catch((failure) => {
        if (active && !receivedEvent)
          setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function runUpdateAction() {
    setPending(true);
    setError(null);
    try {
      const action = update?.canInstall ? 'install' : 'check';
      setUpdate(await window.api.updates[action]());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPending(false);
    }
  }

  const hasUpdate =
    !!update?.version &&
    (update.canInstall ||
      ['checking', 'available', 'downloading', 'installing', 'error'].includes(update.state));
  const nativeTitleBar = window.api.platform === 'win32' && !fullscreen;
  if (!nativeTitleBar && !fullscreen && !hasUpdate && !error) return null;
  const installing = update?.state === 'installing';
  const busy =
    pending ||
    (!!update && ['checking', 'available', 'downloading', 'installing'].includes(update.state));
  const errorMessage = error ?? (update?.state === 'error' ? update.message : undefined);
  let label = 'Retry update';
  if (installing) label = 'Updating…';
  else if (update?.canInstall) label = 'Restart to update';
  else if (update?.state === 'checking') label = 'Checking for updates…';
  else if (update?.state === 'downloading')
    label = `Downloading update · ${Math.round(update.percent ?? 0)}%`;
  else if (update?.state === 'available') label = 'Downloading update…';

  return (
    <header className={`app-header${nativeTitleBar ? ' app-titlebar' : ''}`}>
      <ClaudeIcon size={16} />
      <span className="app-header-title">Parallel Agents</span>
      {(hasUpdate || error) && (
        <div className="app-update">
          {errorMessage && (
            <span className="app-update-error" role="alert" title={errorMessage}>
              {errorMessage}
            </span>
          )}
          <button
            type="button"
            className="app-update-button"
            disabled={busy}
            title={
              update?.version
                ? `Update to version ${update.version}. Your agents keep running until you confirm a restart.`
                : 'Retry checking for updates'
            }
            onClick={() => void runUpdateAction()}
          >
            <span role="status" aria-live="polite">
              {label}
            </span>
          </button>
        </div>
      )}
    </header>
  );
}
