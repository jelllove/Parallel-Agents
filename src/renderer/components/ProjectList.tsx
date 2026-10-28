import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/app-store';
import type { Project, AgentId, AgentInfo } from '../../shared/types';
import { folderIconUrl } from '../icons/iconResolver';
import { AgentIcon } from './AgentIcon';
import { ProjectDeleteDialog } from './ProjectDeleteDialog';
import { canDeleteProject } from '../../shared/project-delete';
import { ActionIcon } from './ActionIcon';

const TREE_AGENTS: AgentId[] = ['copilot', 'codex', 'claude', 'gemini', 'aider'];

export function ProjectList() {
  const projects = useAppStore((s) => s.projects);
  const refresh = useAppStore((s) => s.refreshProjectsAndAgents);
  const refreshing = useAppStore((s) => s.inventoryRefreshing);
  const inventoryError = useAppStore((s) => s.inventoryError);
  const selectedId = useAppStore((s) => s.selectedProjectId);
  const openProjectFromList = useAppStore((s) => s.openProjectFromList);
  const pinProject = useAppStore((s) => s.pinProject);
  const hideProject = useAppStore((s) => s.hideProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const deleteMissingProjects = useAppStore((s) => s.deleteMissingProjects);
  const reorderProjects = useAppStore((s) => s.reorderProjects);
  const showHidden = useAppStore((s) => s.showHidden);
  const setShowHidden = useAppStore((s) => s.setShowHidden);
  const agents = useAppStore((s) => s.agents);
  const status = useAppStore((s) => s.agentStatus);
  const agentsChecked = useAppStore((s) => s.agentsChecked);
  const collapsedAgents = useAppStore((s) => s.collapsedAgents);
  const toggleAgentGroup = useAppStore((s) => s.toggleAgentGroup);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; project: Project } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const [cleanupMode, setCleanupMode] = useState(false);
  const [selectedMissingIds, setSelectedMissingIds] = useState<string[]>([]);
  const [confirmBulkIds, setConfirmBulkIds] = useState<string[] | null>(null);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const out: Record<AgentId, Project[]> = {
      claude: [],
      codex: [],
      gemini: [],
      aider: [],
      copilot: [],
    };
    for (const p of projects) out[p.agent].push(p);
    return out;
  }, [projects]);

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

  async function openInstallGuide(agent: AgentInfo) {
    setInstallError(null);
    try {
      await window.api.shell.openExternal(agent.installUrl);
    } catch (error) {
      setInstallError(
        `Could not open ${agent.displayName} installation guide: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
    <div onClick={() => setCtxMenu(null)}>
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
      {inventoryError && (
        <div className="inventory-error" role="alert">
          {inventoryError}
        </div>
      )}
      {installError && (
        <div className="inventory-error" role="alert">
          {installError}
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
      {TREE_AGENTS.map((agent) => {
        const group = grouped[agent];
        const visible = group.filter((p) => showHidden || !p.hidden);
        const collapsed = collapsedAgents.includes(agent);
        const info = agents.find((item) => item.id === agent);
        const name = info?.displayName ?? agent;
        const missing = agentsChecked && status[agent]?.available === false;
        return (
          <div key={agent} className="agent-group">
            <div
              className={`agent-group-header${missing ? ' unavailable' : ''}`}
              title={missing ? `${name} (not installed)` : name}
            >
              <button
                type="button"
                className="agent-group-toggle"
                onClick={() => toggleAgentGroup(agent)}
                aria-label={missing ? `${name} (not installed)` : name}
                aria-expanded={!collapsed}
              >
                <span className={`agent-group-caret ${collapsed ? 'collapsed' : ''}`}>▾</span>
                <AgentIcon
                  agent={agent}
                  size={18}
                  className={`agent-group-icon${agent === 'copilot' ? ' agent-group-icon-copilot' : ''}`}
                />
                <span className="agent-group-name">{name}</span>
                {missing && (
                  <span className="agent-missing" role="img" aria-label="Not installed">
                    ⚠️
                  </span>
                )}
                <span className="agent-group-count">{group.length}</span>
              </button>
              {missing && info && (
                <button
                  type="button"
                  className="agent-install"
                  aria-label={`Install ${name}`}
                  title={`Install ${name}: ${info.installHint}`}
                  onClick={() => void openInstallGuide(info)}
                >
                  Install
                </button>
              )}
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
                  <div
                    key={p.id}
                    draggable={!cleanupMode}
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
                            event.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id),
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
                      </div>
                      <div className="list-item-sub">{p.realPath}</div>
                    </div>
                  </div>
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
