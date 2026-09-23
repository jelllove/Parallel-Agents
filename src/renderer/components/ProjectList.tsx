import { Fragment, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/app-store';
import type { Project, AgentId } from '../../shared/types';
import { folderIconUrl } from '../icons/iconResolver';
import { AgentIcon } from './AgentIcon';
import { ProjectDeleteDialog } from './ProjectDeleteDialog';
import { NewProjectDialog } from './NewProjectDialog';
import { canDeleteProject } from '../../shared/project-delete';
import { ActionIcon } from './ActionIcon';
import { SortPicker } from './SortPicker';
import { SORT_KEYS, sortBy } from '../../shared/sorting';
import { ActivityBadge } from './ActivityBadge';
import { projectActivity } from '../../shared/activity-rollup';

const TREE_AGENTS: AgentId[] = ['copilot', 'codex', 'claude', 'gemini', 'aider'];

export function ProjectList() {
  const projects = useAppStore((s) => s.projects);
  const refresh = useAppStore((s) => s.refreshProjectsAndAgents);
  const refreshing = useAppStore((s) => s.inventoryRefreshing);
  const inventoryError = useAppStore((s) => s.inventoryError);
  const selectedId = useAppStore((s) => s.selectedProjectId);
  const openProjectFromList = useAppStore((s) => s.openProjectFromList);
  const openNewSession = useAppStore((s) => s.openNewSession);
  const pinProject = useAppStore((s) => s.pinProject);
  const hideProject = useAppStore((s) => s.hideProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const deleteMissingProjects = useAppStore((s) => s.deleteMissingProjects);
  const reorderProjects = useAppStore((s) => s.reorderProjects);
  const showHidden = useAppStore((s) => s.showHidden);
  const setShowHidden = useAppStore((s) => s.setShowHidden);
  const agents = useAppStore((s) => s.agents);
  const status = useAppStore((s) => s.agentStatus);
  const collapsedAgents = useAppStore((s) => s.collapsedAgents);
  const toggleAgentGroup = useAppStore((s) => s.toggleAgentGroup);
  const sortKey = useAppStore((s) => s.sortOrders.projects);
  const tabActivity = useAppStore((s) => s.tabActivity);
  const tabProjectId = useAppStore((s) => s.tabProjectId);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; project: Project } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const [worktreeFor, setWorktreeFor] = useState<Project | null>(null);
  const [cleanupMode, setCleanupMode] = useState(false);
  const [selectedMissingIds, setSelectedMissingIds] = useState<string[]>([]);
  const [confirmBulkIds, setConfirmBulkIds] = useState<string[] | null>(null);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const out: Record<AgentId, Project[]> = {
      claude: [],
      codex: [],
      gemini: [],
      aider: [],
      copilot: [],
    };
    const sorted = sortBy(projects, sortKey, {
      name: (p) => p.displayName,
      created: (p) => p.createdAt,
      modified: (p) => p.lastActivity,
    });
    const pinnedFirst = [...sorted.filter((p) => p.pinned), ...sorted.filter((p) => !p.pinned)];
    for (const p of pinnedFirst) out[p.agent].push(p);
    return out;
  }, [projects, sortKey]);

  const hiddenCount = useMemo(() => projects.filter((p) => p.hidden).length, [projects]);
  const missingProjects = useMemo(
    () => projects.filter((p) => !p.exists && canDeleteProject(p.agent)),
    [projects],
  );

  useEffect(() => {
    const valid = new Set(missingProjects.map((project) => project.id));
    setSelectedMissingIds((ids) => ids.filter((id) => valid.has(id)));
    if (missingProjects.length === 0) setCleanupMode(false);
  }, [missingProjects]);

  function agentName(id: AgentId): string {
    return agents.find((a) => a.id === id)?.displayName ?? id;
  }

  async function handleClick(p: Project) {
    await openProjectFromList(p.id);
  }

  function handleContext(e: React.MouseEvent, p: Project) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, project: p });
  }

  function onDragStart(e: React.DragEvent, p: Project) {
    setDragId(p.id);
    e.dataTransfer.setData('text/plain', p.id);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e: React.DragEvent, target: Project) {
    const src = projects.find((x) => x.id === dragId);
    if (!src || src.agent !== target.agent || src.id === target.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(target.id);
  }

  async function onDrop(e: React.DragEvent, target: Project) {
    e.preventDefault();
    const src = projects.find((x) => x.id === dragId);
    setDragId(null);
    setDragOverId(null);
    if (!src || src.agent !== target.agent || src.id === target.id) return;
    await reorderProjects(target.agent, src.id, target.id);
  }

  return (
    <div className="project-list" onClick={() => setCtxMenu(null)}>
      <div className="project-sticky-actions">
        <div className="project-toolbar">
          <button
            className="project-action"
            title="Refresh projects and agents"
            aria-label="Refresh projects and agents"
            disabled={refreshing || bulkDeleteBusy}
            onClick={() => void refresh()}
          >
            <ActionIcon name="refresh" spinning={refreshing} />
            <span>{refreshing ? 'Refreshing' : 'Refresh'}</span>
          </button>
          <button
            className={`project-action${cleanupMode ? ' selected' : ''}`}
            title={`Clean ${missingProjects.length} deleted project histories`}
            aria-label={`Clean deleted projects (${missingProjects.length})`}
            aria-pressed={cleanupMode}
            disabled={missingProjects.length === 0 || bulkDeleteBusy}
            onClick={() => setCleanupMode(!cleanupMode)}
          >
            <ActionIcon name="cleanup" />
            <span>Clean</span>
            <span className="action-count">{missingProjects.length}</span>
          </button>
        </div>
        <div className="panel-sort-row">
          <SortPicker panel="projects" keys={SORT_KEYS} />
        </div>
        {inventoryError && (
          <div className="inventory-error" role="alert">
            {inventoryError}
          </div>
        )}
        {missingProjects.length > 0 && cleanupMode && (
          <div className="project-cleanup-bar">
            <>
              <button
                className="btn-danger"
                disabled={selectedMissingIds.length === 0}
                onClick={() => {
                  setConfirmBulkIds(selectedMissingIds);
                }}
              >
                Delete selected ({selectedMissingIds.length})
              </button>
              <button
                className="btn-danger"
                onClick={() => {
                  setConfirmBulkIds(missingProjects.map((project) => project.id));
                }}
              >
                Delete all deleted
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setCleanupMode(false);
                  setSelectedMissingIds([]);
                }}
              >
                Cancel
              </button>
            </>
          </div>
        )}
      </div>
      <div className="sidebar-scroll project-tree">
        {TREE_AGENTS.map((agent) => {
          const group = grouped[agent];
          const visible = group.filter((p) => showHidden || !p.hidden);
          const collapsed = collapsedAgents.includes(agent);
          const available = status[agent]?.available;
          return (
            <div key={agent} className="agent-group">
              <div
                className={`agent-group-header ${available ? '' : 'unavailable'}`}
                onClick={() => toggleAgentGroup(agent)}
                title={available ? agentName(agent) : `${agentName(agent)} (not installed)`}
              >
                <span className={`agent-group-caret ${collapsed ? 'collapsed' : ''}`}>▾</span>
                <AgentIcon
                  agent={agent}
                  size={18}
                  className={`agent-group-icon${agent === 'copilot' ? ' agent-group-icon-copilot' : ''}`}
                />
                <span className="agent-group-name">{agentName(agent)}</span>
                <span className="agent-group-count">{group.length}</span>
              </div>
              {!collapsed && (
                <div className="agent-group-body">
                  {agent === 'codex' && group.length === 0 && (
                    <div className="list-item-sub agent-group-empty">
                      (use <code>codex resume --last</code>)
                    </div>
                  )}
                  {agent !== 'codex' && visible.length === 0 && (
                    <div className="list-item-sub agent-group-empty">(none)</div>
                  )}
                  {visible.map((p) => (
                    <Fragment key={p.id}>
                      <div
                        key={p.id}
                        draggable={!cleanupMode && sortKey === 'custom'}
                        onDragStart={(e) => onDragStart(e, p)}
                        onDragOver={(e) => onDragOver(e, p)}
                        onDragLeave={() => setDragOverId((cur) => (cur === p.id ? null : cur))}
                        onDrop={(e) => onDrop(e, p)}
                        className={[
                          'list-item project-item',
                          selectedId === p.id ? 'active' : '',
                          !p.exists ? 'missing' : '',
                          p.hidden ? 'hidden-proj' : '',
                          dragOverId === p.id ? 'drag-over' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => handleClick(p)}
                        onContextMenu={(e) => handleContext(e, p)}
                        title={p.realPath + (p.exists ? '' : ' (directory not found)')}
                      >
                        {cleanupMode && !p.exists && canDeleteProject(p.agent) && (
                          <input
                            type="checkbox"
                            className="project-cleanup-check"
                            checked={selectedMissingIds.includes(p.id)}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => {
                              setSelectedMissingIds((ids) =>
                                event.target.checked
                                  ? [...ids, p.id]
                                  : ids.filter((id) => id !== p.id),
                              );
                            }}
                            aria-label={`Select ${p.displayName} for deletion`}
                          />
                        )}
                        <img
                          className="project-icon"
                          src={folderIconUrl(p.displayName, selectedId === p.id)}
                          alt=""
                          draggable={false}
                        />
                        <div className="project-text">
                          <div className="list-item-title">
                            {p.pinned ? '📌 ' : ''}
                            {p.displayName}
                            <ActivityBadge
                              state={projectActivity(p.id, tabProjectId, tabActivity)}
                            />
                            {p.worktreeCount && p.worktreeCount > 1 ? (
                              <span
                                className="worktree-badge"
                                title={`${p.worktreeCount} folders: main repository and its worktrees`}
                              >
                                +{p.worktreeCount - 1} worktree{p.worktreeCount > 2 ? 's' : ''}
                              </span>
                            ) : null}
                          </div>
                          <div className="list-item-sub">{p.realPath}</div>
                        </div>
                        {p.exists && !cleanupMode && (
                          <div className="project-row-actions">
                            <button
                              type="button"
                              className="project-row-action"
                              title={`New ${agentName(p.agent)} session`}
                              aria-label={`New session in ${p.displayName}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void openNewSession(p.id);
                              }}
                            >
                              +
                            </button>
                            <button
                              type="button"
                              className="project-row-action worktree"
                              title="Create a worktree from the latest main branch"
                              aria-label={`Create a worktree for ${p.displayName}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setWorktreeFor(p);
                              }}
                            >
                              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                                <path
                                  d="M4 2v7.5M4 9.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 0c0-3 7-2 7-6M11 3.5a1.5 1.5 0 1 0 0-.01"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.4"
                                  strokeLinecap="round"
                                />
                                <path
                                  d="M12.5 10v5M10 12.5h5"
                                  stroke="currentColor"
                                  strokeWidth="1.6"
                                  strokeLinecap="round"
                                />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {hiddenCount > 0 && (
          <div
            className="list-item"
            style={{ fontStyle: 'italic', color: 'var(--text-dim)' }}
            onClick={() => setShowHidden(!showHidden)}
          >
            <div className="list-item-sub">
              {showHidden ? '▲ hide hidden' : `▼ show ${hiddenCount} hidden`}
            </div>
          </div>
        )}
      </div>
      {ctxMenu && (
        <div
          className="ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="ctx-menu-item"
            onClick={() => {
              pinProject(ctxMenu.project.id, !ctxMenu.project.pinned);
              setCtxMenu(null);
            }}
          >
            {ctxMenu.project.pinned ? 'Unpin' : 'Pin to top'}
          </div>
          <div
            className="ctx-menu-item"
            onClick={() => {
              hideProject(ctxMenu.project.id, !ctxMenu.project.hidden);
              setCtxMenu(null);
            }}
          >
            {ctxMenu.project.hidden ? 'Unhide' : 'Hide'}
          </div>
          <div className="ctx-menu-divider" />
          <div
            className="ctx-menu-item"
            onClick={() => {
              void navigator.clipboard.writeText(ctxMenu.project.realPath);
              setCtxMenu(null);
            }}
          >
            Copy folder path
          </div>
          <div
            className={`ctx-menu-item${ctxMenu.project.exists ? '' : ' disabled'}`}
            onClick={() => {
              if (ctxMenu.project.exists) void openNewSession(ctxMenu.project.id);
              setCtxMenu(null);
            }}
          >
            New session
          </div>
          <div
            className={`ctx-menu-item${ctxMenu.project.exists ? '' : ' disabled'}`}
            title={ctxMenu.project.exists ? undefined : 'Directory not found on disk'}
            onClick={() => {
              if (ctxMenu.project.exists) void window.api.fs.openDefault(ctxMenu.project.realPath);
              setCtxMenu(null);
            }}
          >
            Open folder in File Explorer
          </div>
          <div
            className={`ctx-menu-item${ctxMenu.project.exists ? '' : ' disabled'}`}
            title={
              ctxMenu.project.exists
                ? 'Create a new Git worktree from the latest main branch'
                : 'Directory not found on disk'
            }
            onClick={() => {
              if (ctxMenu.project.exists) setWorktreeFor(ctxMenu.project);
              setCtxMenu(null);
            }}
          >
            Create a worktree...
          </div>
          <div className="ctx-menu-divider" />
          {canDeleteProject(ctxMenu.project.agent) ? (
            <div
              className="ctx-menu-item danger"
              onClick={() => {
                setConfirmDelete(ctxMenu.project);
                setCtxMenu(null);
              }}
            >
              Delete...
            </div>
          ) : (
            <div
              className="ctx-menu-item"
              style={{ opacity: 0.5, cursor: 'not-allowed' }}
              title="Delete is not supported for this agent yet"
            >
              Delete (not supported)
            </div>
          )}
        </div>
      )}
      {worktreeFor && (
        <NewProjectDialog
          agent={worktreeFor.agent}
          initialFolder={worktreeFor.realPath}
          initialMode="worktree"
          onClose={() => setWorktreeFor(null)}
        />
      )}
      {confirmDelete && (
        <ProjectDeleteDialog
          projects={[confirmDelete]}
          onConfirm={async () => {
            await deleteProject(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {confirmBulkIds && (
        <ProjectDeleteDialog
          projects={projects.filter((project) => confirmBulkIds.includes(project.id))}
          onConfirm={async () => {
            if (bulkDeleteBusy) return;
            const ids = confirmBulkIds;
            setBulkDeleteBusy(true);
            try {
              await deleteMissingProjects(ids);
              setConfirmBulkIds(null);
              setSelectedMissingIds([]);
            } finally {
              setBulkDeleteBusy(false);
            }
          }}
          onCancel={() => {
            setConfirmBulkIds(null);
            setBulkDeleteBusy(false);
          }}
        />
      )}
    </div>
  );
}
