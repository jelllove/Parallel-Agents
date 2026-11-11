import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentId, Project, WorkspaceMode } from '../../shared/types';
import { validateSessionName } from '../../shared/session-presentation';
import { useAppStore } from '../store/app-store';
import { ActionIcon } from './ActionIcon';
import { AgentIcon } from './AgentIcon';
import { RecentFolderDropdown } from './RecentFolderDropdown';
import { queueProjectCreation } from '../store/workspace-operations';
import { useWorkspaceRepository } from '../hooks/use-workspace-repository';
import { localBranchDate, suggestedSessionBranch } from '../new-session-branch';
import './NewProjectDialog.css';

export function NewProjectDialog({
  agent,
  sourceProject,
  onClose,
}: {
  agent: AgentId;
  sourceProject?: Project;
  onClose: () => void;
}) {
  const submitted = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const modeRequestBusy = useRef(false);
  const showAgentLaunchSettings = useAppStore((s) => s.showAgentLaunchSettings);
  const agentName = useAppStore((s) => s.agents.find((a) => a.id === agent)?.displayName ?? agent);
  const [mode, setMode] = useState<WorkspaceMode | null>(null);
  const [modePending, setModePending] = useState(true);
  const [modeError, setModeError] = useState('');
  const [basePath, setBasePath] = useState(
    sourceProject?.worktree?.parentPath ?? sourceProject?.realPath ?? '',
  );
  const [manualPath, setManualPath] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [branchOverride, setBranchOverride] = useState<string | null>(null);
  const [targetOverride, setTargetOverride] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState(false);
  const [selectedRef, setSelectedRef] = useState<{ path: string; value: string } | null>(null);
  const [customRef, setCustomRef] = useState('HEAD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [suffix] = useState(() => crypto.randomUUID().slice(0, 8));
  const [branchDate] = useState(() => localBranchDate(new Date()));
  const repository = useWorkspaceRepository(basePath);
  const branch = branchOverride ?? suggestedSessionBranch(sessionTitle, branchDate, suffix);
  const separator = basePath.includes('\\') ? '\\' : '/';
  const targetPath =
    targetOverride ??
    (basePath && branch ? `${basePath}.worktrees${separator}${branch.replace(/[\\/]/g, '-')}` : '');
  const ref =
    selectedRef?.path === basePath ? selectedRef.value : (repository.info?.defaultRef ?? 'HEAD');
  const startPoint = ref === '__custom__' ? customRef : ref;
  const formBusy = busy || modePending;
  const worktreeReady = Boolean(repository.info?.isGit && repository.info.hasHead);
  const titleValid = (() => {
    try {
      validateSessionName(sessionTitle);
      return true;
    } catch {
      return false;
    }
  })();
  const ready = Boolean(
    mode &&
    !modeError &&
    basePath.trim() &&
    titleValid &&
    !formBusy &&
    (mode === 'folder'
      ? repository.info?.exists !== false
      : worktreeReady &&
        !repository.loading &&
        branch.trim() &&
        targetPath.trim() &&
        startPoint.trim()),
  );

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
      if (mounted.current)
        setModeError(
          `Could not ${next === undefined ? 'load' : 'save'} workspace mode: ${error instanceof Error ? error.message : String(error)}`,
        );
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
      .catch((error) => {
        if (active) setHistoryError(`Could not load recent folders: ${String(error)}`);
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const updateBasePath = (path: string) => {
    setBasePath(path);
    setError('');
  };
  async function browse() {
    try {
      const folder = await window.api.dialog.pickDirectory();
      if (folder && mounted.current) updateBasePath(folder);
    } catch (error) {
      if (mounted.current) setError(String(error));
    }
  }
  return (
    <dialog
      ref={dialog}
      className="workflow-dialog new-session-dialog"
      aria-labelledby="new-session-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && !modeRequestBusy.current) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (submitted.current || busy || modeRequestBusy.current) return;
          try {
            const title = validateSessionName(sessionTitle);
            if (!mode || modeError)
              throw new Error('Workspace mode is unavailable. Retry loading it first.');
            if (!basePath.trim()) throw new Error('Choose a project folder.');
            if (
              mode === 'worktree' &&
              (!worktreeReady ||
                repository.loading ||
                !branch.trim() ||
                !targetPath.trim() ||
                !startPoint.trim())
            )
              throw new Error('Choose a valid repository and complete the worktree fields.');
            submitted.current = true;
            setBusy(true);
            setError('');
            const accepted = queueProjectCreation({
              agent,
              mode,
              basePath,
              branch: mode === 'worktree' ? branch : undefined,
              targetPath: mode === 'worktree' ? targetPath : undefined,
              startPoint: mode === 'worktree' ? startPoint : undefined,
              sessionTitle: title,
            });
            if (accepted === null)
              throw new Error('This workspace already has a pending creation.');
            onClose();
          } catch (error) {
            submitted.current = false;
            setBusy(false);
            setError(error instanceof Error ? error.message : String(error));
          }
        }}
      >
        <header className="new-session-header">
          <div className="new-session-heading">
            <span className="new-session-agent">
              <AgentIcon agent={agent} size={22} />
            </span>
            <div>
              <div className="new-session-heading-line">
                <h2 id="new-session-title">New Agent Session</h2>
                <span className="new-session-provider">{agentName}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="workflow-launch-settings new-session-settings"
            disabled={busy}
            aria-label={`Configure ${agentName} approval mode and model`}
            title="Configure approval & model"
            onClick={() => showAgentLaunchSettings(agent)}
          >
            <ActionIcon name="settings" />
          </button>
        </header>
        <div className="new-session-body">
          <section className="new-session-field" aria-label="Project repository">
            <div className="new-session-label">
              <span>
                <ActionIcon name="folder" />
                Project Repository
              </span>
            </div>
            <div className="new-session-repository-row">
              <RecentFolderDropdown
                folders={recentFolders}
                value={basePath}
                disabled={busy || historyLoading}
                onSelect={updateBasePath}
              />
              <button
                type="button"
                className="btn-secondary new-session-browse"
                disabled={busy}
                onClick={() => void browse()}
              >
                <ActionIcon name="folder" />
                Browse...
              </button>
            </div>
            <button
              type="button"
              className="new-session-text-action"
              disabled={busy}
              aria-expanded={manualPath}
              onClick={() => setManualPath((value) => !value)}
            >
              Enter path manually
            </button>
            {manualPath && (
              <input
                aria-label="Project folder"
                value={basePath}
                disabled={busy}
                onChange={(event) => updateBasePath(event.target.value)}
                placeholder="Absolute project folder path"
              />
            )}
            {historyLoading && <p role="status">Loading recent folders…</p>}
            {historyError && (
              <p className="inventory-error" role="alert">
                {historyError}
              </p>
            )}
            {!historyLoading && !historyError && !recentFolders.length && <p>No recent folders.</p>}
            {repository.info?.exists === false && (
              <p className="inventory-error" role="alert">
                Project folder is unavailable.
              </p>
            )}
            {mode === 'worktree' && repository.loading && <p role="status">Checking repository…</p>}
            {repository.error && (
              <p className="inventory-error" role="alert">
                {repository.error}
              </p>
            )}
          </section>
          <section className="new-session-field">
            <div className="new-session-label">
              <span>Workspace Isolation</span>
            </div>
            <div className="new-session-modes" role="group" aria-label="Workspace isolation">
              {(['folder', 'worktree'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  disabled={formBusy || mode === null}
                  aria-pressed={mode === value}
                  onClick={() => void syncMode(value)}
                >
                  <ActionIcon name={value === 'folder' ? 'folder' : 'branch'} />
                  <span>{value === 'folder' ? 'Current Folder' : 'Git Worktree'}</span>
                </button>
              ))}
            </div>
            {modePending && (
              <p role="status">
                {mode === null ? 'Loading workspace mode…' : 'Saving workspace mode…'}
              </p>
            )}
            {modeError && (
              <div role="alert" className="inventory-error">
                {modeError}
                <button
                  type="button"
                  className="new-session-text-action"
                  disabled={formBusy}
                  onClick={() => void syncMode()}
                >
                  Retry workspace mode
                </button>
              </div>
            )}
          </section>
          {mode === 'worktree' && (
            <section className="new-session-field">
              <label className="new-session-label" htmlFor="new-session-base-ref">
                <span>
                  <ActionIcon name="branch" />
                  Base Branch
                </span>
              </label>
              <select
                id="new-session-base-ref"
                aria-label="Base Branch"
                disabled={busy || repository.loading || !worktreeReady}
                value={ref}
                onChange={(event) => setSelectedRef({ path: basePath, value: event.target.value })}
              >
                <option value="HEAD">
                  HEAD
                  {repository.info?.currentBranch
                    ? ` · ${repository.info.currentBranch}`
                    : ' · current commit'}
                </option>
                {repository.info?.refs.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
                <option value="__custom__">Other branch, tag or commit…</option>
              </select>
              {ref === '__custom__' && (
                <input
                  aria-label="Custom start point"
                  value={customRef}
                  disabled={busy}
                  required
                  onChange={(event) => setCustomRef(event.target.value)}
                />
              )}
              {basePath.trim() && !repository.loading && !repository.error && !worktreeReady && (
                <p role="alert">
                  Choose a Git repository with at least one commit to create a worktree.
                </p>
              )}
              <div className="new-session-worktree-details">
                <label className="new-session-label" htmlFor="new-session-branch">
                  <span>New Branch Name</span>
                </label>
                <input
                  id="new-session-branch"
                  aria-label="New branch"
                  value={branch}
                  disabled={busy}
                  required
                  placeholder={`feat/${branchDate}_feature-name`}
                  onChange={(event) => setBranchOverride(event.target.value)}
                />
                <p className="new-session-path-preview">
                  Path: <span>{targetPath || 'Choose a repository'}</span>
                </p>
                <button
                  type="button"
                  className="new-session-text-action"
                  disabled={busy}
                  aria-expanded={editTarget}
                  onClick={() => setEditTarget((value) => !value)}
                >
                  Edit directory…
                </button>
                {editTarget && (
                  <input
                    aria-label="New worktree directory"
                    value={targetPath}
                    disabled={busy}
                    required
                    onChange={(event) => setTargetOverride(event.target.value)}
                  />
                )}
              </div>
            </section>
          )}
          <section className="new-session-field new-session-title-field">
            <label className="new-session-label" htmlFor="new-session-name">
              <span>
                Session Title <span className="new-session-required">*</span>
              </span>
            </label>
            <input
              id="new-session-name"
              autoFocus
              aria-label="Session Title"
              value={sessionTitle}
              disabled={busy}
              required
              maxLength={120}
              placeholder="e.g. Refactor auth flow & add OAuth2"
              onChange={(event) => setSessionTitle(event.target.value)}
            />
          </section>
          {error && (
            <p className="inventory-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="new-session-footer">
          <div className="workflow-actions">
            <button type="button" className="btn-secondary" disabled={formBusy} onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary new-session-launch" type="submit" disabled={!ready}>
              {busy
                ? 'Preparing workspace…'
                : mode === 'worktree'
                  ? 'Create Worktree & Launch'
                  : 'Start Session'}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
