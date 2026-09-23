import { useEffect, useRef, useState } from 'react';
import type { AgentId } from '../../shared/types';
import { useAppStore } from '../store/app-store';
import { defaultWorktreePath, worktreeBranchName } from '../../shared/worktree-naming';

export function NewProjectDialog({
  agent,
  onClose,
  initialFolder,
  initialMode = 'folder',
}: {
  agent: AgentId;
  onClose: () => void;
  initialFolder?: string;
  initialMode?: 'folder' | 'worktree';
}) {
  const createProject = useAppStore((s) => s.createProject);
  const agentName = useAppStore((s) => s.agents.find((a) => a.id === agent)?.displayName ?? agent);
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'folder' | 'worktree'>(initialMode);
  const [basePath, setBasePath] = useState(initialFolder ?? '');
  const [targetPath, setTargetPath] = useState('');
  const [targetPathGenerated, setTargetPathGenerated] = useState(true);
  const [worktreeName, setWorktreeName] = useState('');
  const [branch, setBranch] = useState('');
  const [branchGenerated, setBranchGenerated] = useState(true);
  const [fromLatestDefaultBranch, setFromLatestDefaultBranch] = useState(true);
  const [startPoint, setStartPoint] = useState('HEAD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [isGitRepo, setIsGitRepo] = useState(initialMode === 'worktree');
  const [askWorktree, setAskWorktree] = useState(false);
  const gitCheck = useRef(0);
  useEffect(() => {
    dialog.current?.showModal();
    window.api.workspace
      .getRecentFolders()
      .then((folders) => {
        setRecentFolders(folders);
        if (!initialFolder && folders[0]) void chooseFolder(folders[0]);
      })
      .catch(() => setRecentFolders([]));
  }, []);

  useEffect(() => {
    const check = ++gitCheck.current;
    if (!basePath.trim()) {
      setIsGitRepo(false);
      return;
    }
    const timer = window.setTimeout(() => {
      window.api.workspace
        .isGitRepository(basePath.trim())
        .then((isRepo) => {
          if (check !== gitCheck.current) return;
          setIsGitRepo(isRepo);
          if (!isRepo) setMode('folder');
        })
        .catch(() => {
          if (check === gitCheck.current) setIsGitRepo(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [basePath]);

  async function chooseFolder(folder: string) {
    updateBasePath(folder);
    setMode('folder');
    try {
      const isRepo = await window.api.workspace.isGitRepository(folder);
      setIsGitRepo(isRepo);
      setAskWorktree(isRepo);
    } catch {
      setIsGitRepo(false);
    }
  }

  async function browse() {
    try {
      const folder = await window.api.dialog.pickDirectory();
      if (folder) {
        void window.api.workspace.addRecentFolder(folder).catch(() => undefined);
        await chooseFolder(folder);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function updateBasePath(path: string) {
    setBasePath(path);
    if (targetPathGenerated) setTargetPath(defaultWorktreePath(path, worktreeName));
  }

  function updateWorktreeName(name: string) {
    setWorktreeName(name);
    if (branchGenerated) setBranch(worktreeBranchName(name));
    if (targetPathGenerated) setTargetPath(defaultWorktreePath(basePath, name));
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
            await createProject({
              agent,
              mode,
              basePath,
              targetPath,
              branch,
              startPoint,
              fromLatestDefaultBranch: mode === 'worktree' && fromLatestDefaultBranch,
            });
            void window.api.workspace.addRecentFolder(basePath.trim()).catch(() => undefined);
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>New Project · {agentName}</h2>
        <label className="workflow-field">
          {mode === 'worktree' ? 'Base repository folder' : 'Project folder'}
          <div className="workflow-path">
            <input
              autoFocus
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
        {isGitRepo && (
          <fieldset
            className={`workspace-choice${askWorktree ? ' attention' : ''}`}
            disabled={busy}
          >
            <legend>
              <strong>{basePath.split(/[\\/]/).filter(Boolean).pop()}</strong> is a Git repository.
              How do you want to open it?
            </legend>
            <label className={`choice-card${mode === 'folder' ? ' selected' : ''}`}>
              <input
                type="radio"
                name="workspace-mode"
                checked={mode === 'folder'}
                onChange={() => {
                  setMode('folder');
                  setAskWorktree(false);
                }}
              />
              <span className="choice-text">
                <span className="choice-title">Open this folder</span>
                <span className="choice-desc">Work directly in the existing checkout.</span>
              </span>
            </label>
            <label className={`choice-card${mode === 'worktree' ? ' selected' : ''}`}>
              <input
                type="radio"
                name="workspace-mode"
                checked={mode === 'worktree'}
                onChange={() => {
                  setMode('worktree');
                  setAskWorktree(false);
                }}
              />
              <span className="choice-text">
                <span className="choice-title">Create a new worktree</span>
                <span className="choice-desc">
                  A separate folder and branch, so this checkout stays untouched.
                </span>
              </span>
            </label>
          </fieldset>
        )}
        {mode === 'worktree' && (
          <>
            <label className="workflow-field">
              Worktree name
              <input
                value={worktreeName}
                disabled={busy}
                required
                placeholder="my-task"
                onChange={(e) => updateWorktreeName(e.target.value)}
              />
            </label>
            <label className="workflow-field">
              New branch
              <input
                value={branch}
                disabled={busy}
                required
                onChange={(e) => {
                  setBranchGenerated(false);
                  setBranch(e.target.value);
                }}
              />
            </label>
            <label className="modal-check latest-main-check">
              <input
                type="checkbox"
                checked={fromLatestDefaultBranch}
                disabled={busy}
                onChange={(e) => setFromLatestDefaultBranch(e.target.checked)}
              />
              <span className="choice-text">
                <span className="choice-title">Start from the latest main branch</span>
                <span className="choice-desc">
                  Fetches origin first. Your current folder and branch are not changed.
                </span>
              </span>
            </label>
            {!fromLatestDefaultBranch && (
              <label className="workflow-field">
                Start from branch, tag or commit
                <input
                  value={startPoint}
                  disabled={busy}
                  required
                  onChange={(e) => setStartPoint(e.target.value)}
                />
              </label>
            )}
            <label className="workflow-field">
              Worktree folder
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
        {recentFolders.length > 0 && (
          <div className="workflow-field">
            Recent folders
            <ul className="recent-folders" aria-label="Recent folders">
              {recentFolders.map((folder) => (
                <li key={folder}>
                  <button
                    type="button"
                    className={`recent-folder${folder === basePath ? ' selected' : ''}`}
                    disabled={busy}
                    title={folder}
                    onClick={() => void chooseFolder(folder)}
                  >
                    <span className="recent-folder-name">
                      {folder.split(/[\\/]/).filter(Boolean).pop() ?? folder}
                    </span>
                    <span className="recent-folder-path">{folder}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
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
