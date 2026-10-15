import { useEffect, useRef, useState } from 'react';
import type { AgentId } from '../../shared/types';
import { useAppStore } from '../store/app-store';

export function NewProjectDialog({ agent, onClose }: { agent: AgentId; onClose: () => void }) {
  const createProject = useAppStore((s) => s.createProject);
  const showAgentLaunchSettings = useAppStore((s) => s.showAgentLaunchSettings);
  const agentName = useAppStore((s) => s.agents.find((a) => a.id === agent)?.displayName ?? agent);
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'folder' | 'worktree'>('folder');
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
  const [folderFilter, setFolderFilter] = useState('');
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
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
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
          className="btn-secondary"
          disabled={busy}
          onClick={() => showAgentLaunchSettings(agent)}
        >
          Configure {agentName} approval mode and model
        </button>
        <label className="workflow-field">
          Workspace mode
          <select
            autoFocus
            value={mode}
            disabled={busy}
            onChange={(e) => setMode(e.target.value === 'worktree' ? 'worktree' : 'folder')}
          >
            <option value="folder">Open a folder directly</option>
            <option value="worktree">Create a Git worktree from a base folder</option>
          </select>
        </label>
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
          <label className="workflow-field">
            Recently opened folders
            <input
              type="search"
              aria-label="Filter recent folders"
              placeholder="Filter by folder name or path"
              value={folderFilter}
              disabled={busy}
              onChange={(event) => setFolderFilter(event.target.value)}
            />
          </label>
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
                {recentFolders
                  .filter((folder) => folder.toLowerCase().includes(folderFilter.toLowerCase()))
                  .map((folder) => (
                    <li key={folder}>
                      <button
                        type="button"
                        className={`recent-folder${folder === basePath ? ' selected' : ''}`}
                        title={folder}
                        disabled={busy}
                        aria-pressed={folder === basePath}
                        onClick={() => updateBasePath(folder)}
                      >
                        <span className="recent-folder-name">
                          {folder.split(/[\\/]/).filter(Boolean).pop() ?? folder}
                        </span>
                        <span className="recent-folder-path">{folder}</span>
                      </button>
                    </li>
                  ))}
                {recentFolders.every(
                  (folder) => !folder.toLowerCase().includes(folderFilter.toLowerCase()),
                ) && <li>No matching folders.</li>}
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
          <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" type="submit" disabled={busy}>
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
