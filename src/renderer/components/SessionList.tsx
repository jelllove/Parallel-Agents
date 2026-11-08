import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/app-store';
import { resumeCommandFor } from '../icons/agentIcons';
import { ConfirmDialog } from './ConfirmDialog';
import type { Project } from '../../shared/types';
import { collectProjectSessions } from '../../shared/project-tree';
import type { ProjectSession } from '../../shared/project-tree';
import { RenameSessionDialog } from './RenameSessionDialog';
import { ActionIcon } from './ActionIcon';
import { queueSessionDeletion } from '../store/workspace-operations';
import { useActivityStore, sessionActivityRecord } from '../store/activity-store';
import { SessionActivityIcon } from './SessionActivityIcon';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

interface Props {
  selection?: { selectedKeys: string[]; onToggle: (key: string, checked: boolean) => void };
  projects: Project[];
  onProjectContext?: (event: React.MouseEvent, project: Project) => void;
}

export function SessionList({ projects, onProjectContext, selection }: Props) {
  const activity = useActivityStore((state) => state.records);
  const completions = useActivityStore((state) => state.completions);
  const acknowledge = useActivityStore((state) => state.acknowledge);
  const openTabs = useAppStore((s) => s.openTabs);
  const tabAgent = useAppStore((s) => s.tabAgent);
  const tabSessionId = useAppStore((s) => s.tabSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const loadSessions = useAppStore((s) => s.loadSessions);
  const selectProject = useAppStore((s) => s.selectProject);
  const openSessionTab = useAppStore((s) => s.openSessionTab);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const activeSessionId = useAppStore((s) => s.tabSessionId[s.activeTabId ?? '']);
  const activeAgent = useAppStore((s) => s.tabAgent[s.activeTabId ?? '']);
  const rows = useMemo(() => collectProjectSessions(projects, sessions), [projects, sessions]);
  const [loading, setLoading] = useState(false);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<ProjectSession | null>(null);
  const [rename, setRename] = useState<ProjectSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadErrors([]);
    void Promise.allSettled(projects.map((project) => loadSessions(project.id))).then((results) => {
      if (cancelled) return;
      setLoadErrors(
        results.flatMap((result, i) =>
          result.status === 'rejected'
            ? [
                `${projects[i].displayName}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
              ]
            : [],
        ),
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projects, loadSessions, retry]);

  async function resume({ project, session }: ProjectSession) {
    setError('');
    try {
      await selectProject(project.id);
      await openSessionTab(project.id, session);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="project-sessions" aria-label="Project sessions" aria-busy={loading}>
      {loading && (
        <div className="list-item-sub session-notice" role="status">
          Loading sessions...
        </div>
      )}
      {loadErrors.length > 0 && (
        <div className="inventory-error" role="alert">
          {loadErrors.join('; ')}
          <button className="project-action" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </button>
        </div>
      )}
      {error && !confirmDelete && (
        <div className="inventory-error" role="alert">
          {error}
        </div>
      )}
      {rows.map((row) => {
        const { project, session: s } = row;
        const cmd = resumeCommandFor(s.agent, s.id);
        const enabled = Boolean(cmd && project.exists);
        const branch = project.worktree
          ? s.gitBranch || project.worktree.branch || 'detached HEAD'
          : null;
        const active = Boolean(activeTabId && activeSessionId === s.id && activeAgent === s.agent);
        const selected = selection?.selectedKeys.includes(`${s.agent}:${s.id}`);
        const record = sessionActivityRecord(activity, s.agent, s.id, {
          openTabs,
          tabAgent,
          tabSessionId,
        });
        const completion =
          record?.state === 'completed' ? completions[record.terminalKey] : undefined;
        const acknowledgeCompletion = () => {
          if (completion) acknowledge(completion.token);
        };
        return (
          <div
            key={`${s.agent}:${s.id}`}
            className={`list-item session-item${enabled ? '' : ' disabled'}${active ? ' active' : ''}${selected ? ' deletion-selected' : ''}`}
            onContextMenu={(event) => onProjectContext?.(event, project)}
          >
            {selection && (
              <input
                type="checkbox"
                className="session-selection-check"
                aria-label={`Select session ${s.title || s.id} for deletion`}
                checked={Boolean(selected)}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => selection.onToggle(`${s.agent}:${s.id}`, event.target.checked)}
              />
            )}
            <span className={`session-marker${active ? ' active' : ''}`} aria-hidden="true">
              {active ? '▶' : undefined}
            </span>
            <SessionActivityIcon
              state={record?.state ?? 'unknown'}
              attention={Boolean(completion && !completion.acknowledged)}
              onAcknowledge={acknowledgeCompletion}
            />
            <button
              className="session-open"
              disabled={!enabled}
              onClick={() => {
                acknowledgeCompletion();
                void resume(row);
              }}
              title={`${s.title}\n${project.realPath}\n${!project.exists ? 'Directory not found' : cmd || `No resume available for ${s.agent}`}`}
              aria-current={active ? 'true' : undefined}
            >
              <span className="session-text">
                <span className="list-item-title">{s.title || '(empty)'}</span>
                <span className="list-item-sub session-meta">
                  {branch && (
                    <>
                      <span className="session-branch-icon">
                        <ActionIcon name="branch" />
                      </span>
                      <span className="session-branch" title={`${branch}\n${project.realPath}`}>
                        {branch}
                      </span>
                      <span className="session-meta-separator" aria-hidden="true">
                        ·
                      </span>
                    </>
                  )}
                  <span>{formatTime(s.timestamp)}</span>
                </span>
              </span>
            </button>
            <button
              className="session-rename"
              title="Rename session"
              aria-label={`Rename ${s.title}`}
              onClick={() => setRename(row)}
            >
              <ActionIcon name="rename" />
            </button>
            <button
              className="session-delete"
              title="Delete this session"
              aria-label={`Delete ${s.title}`}
              onClick={() => {
                setError('');
                setConfirmDelete(row);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      {!loading &&
        loadErrors.length === 0 &&
        projects.map(
          (project) =>
            (sessions[project.id]?.length ?? 0) === 0 && (
              <div
                key={project.id}
                className="session-notice"
                onContextMenu={(event) => onProjectContext?.(event, project)}
              >
                <span className="list-item-sub">
                  {project.worktree ? `${project.worktree.branch || 'detached HEAD'}: ` : ''}No
                  sessions yet.
                </span>
              </div>
            ),
        )}
      {rename && (
        <RenameSessionDialog
          projectId={rename.project.id}
          sessionId={rename.session.id}
          title={rename.session.title}
          onClose={() => setRename(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete session?"
          message={`This will permanently delete the session file for "${confirmDelete.session.title || '(empty)'}". This cannot be undone.`}
          confirmText="Delete forever"
          warning={error}
          destructive
          onConfirm={() => {
            const accepted = queueSessionDeletion(confirmDelete.project, confirmDelete.session);
            if (accepted === null) {
              setError('This session already has a pending deletion.');
              return;
            }
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
