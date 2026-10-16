import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentId, WorkspaceMode } from '../../shared/types';
import { useAppStore } from '../store/app-store';
import { ActionIcon } from './ActionIcon';
import { folderIconUrl } from '../icons/iconResolver';

export function NewProjectDialog({ agent, onClose }: { agent: AgentId; onClose: () => void }) {
  const createProject = useAppStore((s) => s.createProject);
  const showAgentLaunchSettings = useAppStore((s) => s.showAgentLaunchSettings);
  const agentName = useAppStore((s) => s.agents.find((a) => a.id === agent)?.displayName ?? agent);
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<WorkspaceMode | null>(null);
  const [modePending, setModePending] = useState(true);
  const [modeError, setModeError] = useState('');
  const modeRequestBusy = useRef(false);
  const mounted = useRef(false);
  const [basePath, setBasePath] = useState('');
  const [targetPath, setTargetPath] = useState('');
  const [targetPathGenerated, setTargetPathGenerated] = useState(true);
  const [branch, setBranch] = useState('');
  const [startPoint, setStartPoint] = useState('HEAD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const formBusy = busy || modePending;
  const syncMode = useCallback(async (next?: WorkspaceMode) => {
    if (modeRequestBusy.current) return;
    modeRequestBusy.current = true;
    setModePending(true);
    setModeError('');
    setError('');
    try {
      if (next !== undefined) await window.api.workspace.setMode(next);
      const saved = next ?? (await window.api.workspace.getMode());
      if (mounted.current) setMode(saved);
    } catch (error) {
      if (mounted.current) {
        setModeError(
          `Could not ${next === undefined ? 'load' : 'save'} workspace mode: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } finally {
      modeRequestBusy.current = false;
      if (mounted.current) setModePending(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void syncMode();
    return () => {
      mounted.current = false;
    };
  }, [syncMode]);

  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    void window.api.workspace
      .getRecentFolders()
      .then((folders) => {
        if (active) setRecentFolders(folders);
      })
      .catch((error: unknown) => {
        if (active)
          setHistoryError(
            `Could not load recent folders: ${error instanceof Error ? error.message : String(error)}`,
          );
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function browse() {
    try {
      const folder = await window.api.dialog.pickDirectory();
      if (folder) updateBasePath(folder);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function defaultTargetPath(base: string, name: string) {
    if (!base || !name) return '';
    const separator = base.includes('\\') ? '\\' : '/';
    return `${base}.worktrees${separator}${name.replace(/[\\/]/g, '-')}`;
  }

  function updateBasePath(path: string) {
    setBasePath(path);
    if (targetPathGenerated && branch) setTargetPath(defaultTargetPath(path, branch));
  }

  function updateBranch(name: string) {
    setBranch(name);
    if (targetPathGenerated) setTargetPath(defaultTargetPath(basePath, name));
  }

  return (
    <dialog
      ref={dialog}
      className="workflow-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && !modeRequestBusy.current) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || modeRequestBusy.current) return;
          if (!mode) {
            setError('Workspace mode is unavailable. Retry loading it first.');
            return;
          }
          setBusy(true);
          setError('');
          try {
            await createProject({ agent, mode, basePath, targetPath, branch, startPoint });
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>New Project · {agentName}</h2>
        <button
          type="button"
          className="btn-secondary workflow-launch-settings"
          disabled={busy}
          onClick={() => showAgentLaunchSettings(agent)}
        >
          <ActionIcon name="settings" />
          <span>Configure {agentName} approval mode and model</span>
        </button>
        <label className="workflow-field">
          Workspace mode
          <select
            autoFocus
            aria-label="Workspace mode"
            value={mode ?? ''}
            disabled={formBusy || mode === null}
            onChange={async (e) => {
              const next = e.target.value;
              if (next !== 'folder' && next !== 'worktree') {
                setModeError('Choose a valid workspace mode.');
                return;
              }
              await syncMode(next);
            }}
          >
            {mode === null && (
              <option value="" disabled>
                {modePending ? 'Loading workspace mode...' : 'Workspace mode unavailable'}
              </option>
            )}
            <option value="folder">📂 Open a folder directly</option>
            <option value="worktree">🌿 Create a Git worktree from a base folder</option>
          </select>
        </label>
        {modePending && (
          <p role="status">
            {mode === null ? 'Loading workspace mode...' : 'Saving workspace mode...'}
          </p>
        )}
        {modeError && (
          <>
            <p className="inventory-error" role="alert">
              {modeError}
            </p>
            <button
              type="button"
              className="btn-secondary"
              disabled={formBusy}
              onClick={() => syncMode()}
            >
              Retry workspace mode
            </button>
          </>
        )}
        <label className="workflow-field">
          {mode === 'worktree' ? 'Base repository folder' : 'Project folder'}
          <div className="workflow-path">
            <input
              value={basePath}
              disabled={busy}
              required
              onChange={(e) => updateBasePath(e.target.value)}
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => void browse()}
            >
              Browse...
            </button>
          </div>
        </label>
        <section className="recent-folders-section" aria-label="Recent folders">
          <h3 className="recent-folders-heading">Recently opened folders</h3>
          {historyLoading && <p role="status">Loading recent folders...</p>}
          {historyError && (
            <p className="inventory-error" role="alert">
              {historyError}
            </p>
          )}
          {!historyLoading &&
            !historyError &&
            (recentFolders.length === 0 ? (
              <p>No previously opened folders yet.</p>
            ) : (
              <ul className="recent-folders" aria-label="Recently opened folder paths">
                {recentFolders.map((folder) => (
                  <li key={folder}>
                    <button
                      type="button"
                      className={`recent-folder${folder === basePath ? ' selected' : ''}`}
                      title={folder}
                      disabled={busy}
                      aria-pressed={folder === basePath}
                      onClick={() => updateBasePath(folder)}
                    >
                      <img
                        className="recent-folder-icon"
                        src={folderIconUrl(
                          folder.split(/[\\/]/).filter(Boolean).pop() ?? folder,
                          folder === basePath,
                        )}
                        alt=""
                        draggable={false}
                      />
                      <span className="recent-folder-text">
                        <span className="recent-folder-name">
                          {folder.split(/[\\/]/).filter(Boolean).pop() ?? folder}
                        </span>
                        <span className="recent-folder-path">{folder}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </section>
        {mode === 'worktree' && (
          <>
            <label className="workflow-field">
              New branch
              <input
                value={branch}
                disabled={busy}
                required
                placeholder="feature/my-task"
                onChange={(e) => updateBranch(e.target.value)}
              />
            </label>
            <label className="workflow-field">
              Start from branch, tag or commit
              <input
                value={startPoint}
                disabled={busy}
                required
                onChange={(e) => setStartPoint(e.target.value)}
              />
            </label>
            <label className="workflow-field">
              New worktree directory (absolute path)
              <input
                value={targetPath}
                disabled={busy}
                required
                onChange={(e) => {
                  setTargetPathGenerated(false);
                  setTargetPath(e.target.value);
                }}
              />
            </label>
            <p>
              Git creates a new branch and linked worktree. Existing folders are never overwritten;
              uncommitted changes stay in the base folder.
            </p>
          </>
        )}
        {error && (
          <p className="inventory-error" role="alert">
            {error}
          </p>
        )}
        <div className="workflow-actions">
          <button type="button" className="btn-secondary" disabled={formBusy} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" type="submit" disabled={formBusy || mode === null}>
            {busy
              ? 'Preparing workspace...'
              : mode === 'worktree'
                ? 'Create worktree & launch'
                : 'Open folder & launch'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
