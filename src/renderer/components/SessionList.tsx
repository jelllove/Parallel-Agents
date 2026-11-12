import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/app-store';
import { resumeCommandFor } from '../icons/agentIcons';
import { SessionDeleteDialog } from './SessionDeleteDialog';
import type { Project } from '../../shared/types';
import { collectProjectSessions } from '../../shared/project-tree';
import type { ProjectSession } from '../../shared/project-tree';
import { draftSessionRows } from '../../shared/managed-session';
import { RenameSessionDialog } from './RenameSessionDialog';
import { ActionIcon } from './ActionIcon';
import { useActivityStore } from '../store/activity-store';
import { SessionActivityIcon } from './SessionActivityIcon';
import type { SidebarSessionRow } from '../../shared/managed-session';
import { useSessionOrder, sessionRowKey } from '../hooks/use-session-order';
import { SessionOrderControls, activeSessionDrag } from './SessionOrderControls';
import { pathKey } from '../../shared/project-tree';
import { useWindowedRows } from '../hooks/use-windowed-rows';

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
  const acknowledge = useActivityStore((state) => state.acknowledge);
  const openTabs = useAppStore((s) => s.openTabs);
  const tabAgent = useAppStore((s) => s.tabAgent);
  const tabProjectId = useAppStore((s) => s.tabProjectId);
  const managedTabs = useAppStore((s) => s.managedTabs);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const tabSessionId = useAppStore((s) => s.tabSessionId);
  const groupSessions = useAppStore(
    useShallow((s) => projects.map((project) => s.sessions[project.id])),
  );
  const projectIds = new Set(projects.map((project) => project.id));
  const groupNative = new Set(
    groupSessions.flatMap((sessions) =>
      (sessions ?? []).map((session) => `${session.agent}:${session.id}`),
    ),
  );
  const relevantTabs = new Set(
    openTabs
      .filter(
        (tab) =>
          projectIds.has(tabProjectId[tab] ?? tab) ||
          groupNative.has(`${tabAgent[tab]}:${tabSessionId[tab]}`),
      )
      .map((tab) => `${tab}::agent`),
  );
  const activity = useActivityStore(
    useShallow((state) => state.records.filter((record) => relevantTabs.has(record.terminalKey))),
  );
  const groupCompletions = useActivityStore(
    useShallow((state) => activity.map((record) => state.completions[record.terminalKey])),
  );
  const completions = Object.fromEntries(
    activity.map((record, index) => [record.terminalKey, groupCompletions[index]]),
  );
  const openNative = new Set(
    openTabs
      .filter((tab) => tabSessionId[tab])
      .map((tab) => `${tabAgent[tab]}:${tabSessionId[tab]}`),
  );
  const activityBySession = new Map<string, (typeof activity)[number]>();
  for (const record of activity) {
    const key = `${record.agent}:${record.sessionId}`;
    if (openNative.has(key) && (activityBySession.get(key)?.revision ?? -1) < record.revision)
      activityBySession.set(key, record);
  }
  const sessions = useMemo(
    () =>
      Object.fromEntries(
        projects.map((project, index) => [project.id, groupSessions[index] ?? []]),
      ),
    [projects, groupSessions],
  );
  const loadSessions = useAppStore((s) => s.loadSessions);
  const selectProject = useAppStore((s) => s.selectProject);
  const openSessionTab = useAppStore((s) => s.openSessionTab);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const activeSessionId = useAppStore((s) => s.tabSessionId[s.activeTabId ?? '']);
  const activeAgent = useAppStore((s) => s.tabAgent[s.activeTabId ?? '']);
  const rows = useMemo(() => collectProjectSessions(projects, sessions), [projects, sessions]);
  const drafts = draftSessionRows(projects, {
    openTabs,
    tabProjectId,
    tabSessionId,
    tabAgent,
    managedTabs,
  });
  const combined: SidebarSessionRow[] = [
    ...rows.map((row) => ({ kind: 'history' as const, ...row })),
    ...drafts,
  ];
  const order = useSessionOrder(projects, combined, managedTabs);
  const scope = `${projects[0]?.agent}:${pathKey(projects[0]?.worktree?.parentPath ?? projects[0]?.realPath ?? '')}`;
  const orderDisabled = !order.loaded || order.saving || Boolean(selection);
  const [dropTarget, setDropTarget] = useState<{
    key: string;
    placement: 'before' | 'after';
  } | null>(null);
  const orderingProps = (rowKey: string) => ({
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
      if (
        orderDisabled ||
        activeSessionDrag?.scope !== scope ||
        activeSessionDrag.key === rowKey ||
        !event.dataTransfer.types.includes('application/x-parallel-agents-session')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      setDropTarget({
        key: rowKey,
        placement: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after',
      });
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const target = dropTarget;
      setDropTarget(null);
      if (orderDisabled || !target) return;
      try {
        const from = JSON.parse(
          event.dataTransfer.getData('application/x-parallel-agents-session'),
        );
        if (
          from.scope === scope &&
          from.key !== rowKey &&
          order.ordered.some((item) => sessionRowKey(item, managedTabs) === from.key)
        )
          void order.move(from.key, rowKey, target.placement);
      } catch {
        /* An unrelated drag has no ordering authority. */
      }
    },
    onDragEnd: () => setDropTarget(null),
  });
  const orderedKeys = order.ordered.map((row) => sessionRowKey(row, managedTabs));
  const neighbors = new Map(
    orderedKeys.map((key, index) => [
      key,
      { previous: orderedKeys[index - 1], next: orderedKeys[index + 1] },
    ]),
  );
  const windowed = useWindowedRows(
    orderedKeys,
    activeSessionId
      ? `${activeAgent}:${activeSessionId}`
      : activeTabId && managedTabs[activeTabId]
        ? `draft:${managedTabs[activeTabId].launchId}`
        : undefined,
    Boolean(selection),
  );
  const controls = (rowKey: string, label: string) => {
    const { previous, next } = neighbors.get(rowKey)!;
    return (
      <SessionOrderControls
        rowKey={rowKey}
        scope={scope}
        label={label}
        disabled={orderDisabled}
        previous={previous}
        next={next}
        onMove={order.move}
        onDragFinished={() => setDropTarget(null)}
      />
    );
  };
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
    <div
      ref={windowed.root}
      className="project-sessions"
      aria-label="Project sessions"
      aria-busy={loading}
      onDragStartCapture={() => windowed.setDragging(true)}
      onDragEndCapture={() => windowed.setDragging(false)}
      onDropCapture={() => windowed.setDragging(false)}
    >
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
      {order.error && (
        <div role="alert" className="inventory-error">
          {order.error}
          <button className="project-action" onClick={() => void order.reload()}>
            Retry positions
          </button>
        </div>
      )}
      {order.ordered.map((row, index) => {
        const rowKey = sessionRowKey(row, managedTabs);
        const virtual = windowed.rows[index];
        if (!virtual.visible) {
          if (index > 0 && !windowed.rows[index - 1].visible) return null;
          let height = 0;
          for (
            let next = index;
            next < windowed.rows.length && !windowed.rows[next].visible;
            next++
          )
            height += windowed.rows[next].height;
          return <div key={`spacer:${rowKey}`} style={{ height }} aria-hidden="true" />;
        }
        const virtualProps = {
          'data-virtual-key': rowKey,
          onFocusCapture: () => windowed.setFocused(rowKey),
        };
        const dropClass = dropTarget?.key === rowKey ? ` session-drop-${dropTarget.placement}` : '';
        if (row.kind === 'draft')
          return (
            <div
              key={rowKey}
              {...orderingProps(rowKey)}
              {...virtualProps}
              className={`list-item session-item session-draft${activeTabId === row.tabId ? ' active' : ''}${dropClass}`}
            >
              {controls(rowKey, row.title)}
              <span
                className={`session-marker${activeTabId === row.tabId ? ' active' : ''}`}
                aria-hidden="true"
              >
                {activeTabId === row.tabId ? '▶' : undefined}
              </span>
              <SessionActivityIcon />
              <button
                className="session-open"
                aria-current={activeTabId === row.tabId ? 'true' : undefined}
                onClick={() => setActiveTab(row.tabId)}
                title={`${row.title}\n${row.project.realPath}\nWaiting for native session history`}
              >
                <span className="session-text">
                  <span className="list-item-title">{row.title}</span>
                  <span className="list-item-sub session-meta">{formatTime(row.createdAt)}</span>
                </span>
              </button>
            </div>
          );
        const { project, session: s } = row;
        const cmd = resumeCommandFor(s.agent, s.id);
        const enabled = Boolean(cmd && project.exists);
        const branch = project.worktree
          ? s.gitBranch || project.worktree.branch || 'detached HEAD'
          : null;
        const active = Boolean(activeTabId && activeSessionId === s.id && activeAgent === s.agent);
        const selected = selection?.selectedKeys.includes(`${s.agent}:${s.id}`);
        const nativeKey = `${s.agent}:${s.id}`;
        const isOpen = openNative.has(nativeKey);
        const record = activityBySession.get(nativeKey);
        const completion =
          record?.state === 'completed' ? completions[record.terminalKey] : undefined;
        const acknowledgeCompletion = () => {
          if (completion) acknowledge(completion.token);
        };
        return (
          <div
            key={`${s.agent}:${s.id}`}
            {...orderingProps(rowKey)}
            {...virtualProps}
            className={`list-item session-item${enabled ? '' : ' disabled'}${active ? ' active' : ''}${selected ? ' deletion-selected' : ''}${dropClass}`}
            onContextMenu={(event) => onProjectContext?.(event, project)}
          >
            {controls(rowKey, s.title || s.id)}
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
              isOpen={isOpen}
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
            !project.worktree &&
            (sessions[project.id]?.length ?? 0) === 0 &&
            !drafts.some((row) => row.project.id === project.id) && (
              <div
                key={project.id}
                className="session-notice"
                onContextMenu={(event) => onProjectContext?.(event, project)}
              >
                <span className="list-item-sub">No sessions yet.</span>
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
        <SessionDeleteDialog
          targets={[confirmDelete]}
          onAccepted={() => setConfirmDelete(null)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
