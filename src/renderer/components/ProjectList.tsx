import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/app-store';
import type { Project, AgentId, AgentLayout } from '../../shared/types';
import { DEFAULT_AGENT_ORDER, moveSidebarItem, orderedAgents } from '../../shared/sidebar-order';
import { folderIconUrl } from '../icons/iconResolver';
import { AgentIcon } from './AgentIcon';
import { ProjectDeleteDialog } from './ProjectDeleteDialog';
import { canDeleteProject } from '../../shared/project-delete';
import { ActionIcon } from './ActionIcon';

export function ProjectList({ onNewProject }: { onNewProject: (agent: AgentId) => void }) {
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
  const [dragAgent, setDragAgent] = useState<AgentId | null>(null);
  const [dragOverAgent, setDragOverAgent] = useState<AgentId | null>(null);
  const [agentMenu, setAgentMenu] = useState<{ x: number; y: number; agent: AgentId } | null>(null);
  const [agentLayout, setAgentLayout] = useState<AgentLayout | null>(null);
  const [sidebarError, setSidebarError] = useState('');
  const [sidebarBusy, setSidebarBusy] = useState(false);
  const actionBusy = useRef(false);
  const agentIds = agentLayout ? orderedAgents(agentLayout) : [...DEFAULT_AGENT_ORDER];
  const orderDisabled = sidebarBusy || !agentLayout || cleanupMode || bulkDeleteBusy;

  useEffect(() => {
    let active = true;
    void window.api.config.getAgentLayout().then(
      (layout) => {
        if (active) setAgentLayout(layout);
      },
      (error: unknown) => {
        if (active) setSidebarError(`Could not load sidebar order: ${String(error)}`);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function runSidebarAction(action: () => Promise<void>) {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setSidebarBusy(true);
    setSidebarError('');
    try {
      await action();
    } catch (error) {
      setSidebarError(
        `Could not update sidebar: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      actionBusy.current = false;
      setSidebarBusy(false);
    }
  }

  async function pinAgent(agent: AgentId) {
    if (!agentLayout) throw new Error('Load sidebar order before pinning an agent.');
    await window.api.config.setAgentPinned(agent, !agentLayout.pinnedAgents.includes(agent));
    setAgentLayout(await window.api.config.getAgentLayout());
  }

  function sameAgentSection(from: AgentId, to: AgentId) {
    return (
      agentLayout &&
      agentLayout.pinnedAgents.includes(from) === agentLayout.pinnedAgents.includes(to)
    );
  }

  async function moveAgent(from: AgentId, to: AgentId) {
    if (!sameAgentSection(from, to))
      throw new Error('Reorder agents within the same pinned section.');
    await window.api.config.setAgentOrder(moveSidebarItem(agentIds, from, to));
    setAgentLayout(await window.api.config.getAgentLayout());
  }

  function adjacentAgent(agent: AgentId, direction: number) {
    const group = agentIds.filter((id) => sameAgentSection(id, agent));
    return group[group.indexOf(agent) + direction];
  }

  function adjacentProject(project: Project, direction: number) {
    const group = projects.filter(
      (p) => p.agent === project.agent && p.pinned === project.pinned && (showHidden || !p.hidden),
    );
    return group[group.findIndex((p) => p.id === project.id) + direction];
  }

  function clearDrag() {
    setDragId(null);
    setDragOverId(null);
    setDragAgent(null);
    setDragOverAgent(null);
  }

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

  function agentName(id: AgentId): string {
    return agents.find((a) => a.id === id)?.displayName ?? id;
  }

  async function handleClick(p: Project) {
    await openProjectFromList(p.id);
  }

  function handleContext(e: React.MouseEvent, p: Project) {
    e.preventDefault();
    setAgentMenu(null);
    setCtxMenu({ x: e.clientX, y: e.clientY, project: p });
  }

  function onDragStart(e: React.DragEvent, p: Project) {
    e.stopPropagation();
    setDragAgent(null);
    setDragId(p.id);
    e.dataTransfer.setData('text/plain', p.id);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e: React.DragEvent, target: Project) {
    const src = projects.find((x) => x.id === dragId);
    if (
      orderDisabled ||
      !src ||
      src.agent !== target.agent ||
      src.pinned !== target.pinned ||
      src.id === target.id
    )
      return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(target.id);
  }

  async function onDrop(e: React.DragEvent, target: Project) {
    e.preventDefault();
    e.stopPropagation();
    const src = projects.find((x) => x.id === dragId);
    clearDrag();
    if (
      orderDisabled ||
      !src ||
      src.agent !== target.agent ||
      src.pinned !== target.pinned ||
      src.id === target.id
    )
      return;
    await runSidebarAction(() => reorderProjects(target.agent, src.id, target.id));
  }

  return (
    <div
      onClick={() => {
        setCtxMenu(null);
        setAgentMenu(null);
      }}
    >
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
      {sidebarError && (
        <div className="inventory-error" role="alert">
          {sidebarError}
          <button
            type="button"
            disabled={sidebarBusy}
            onClick={() =>
              void runSidebarAction(async () => {
                setAgentLayout(await window.api.config.getAgentLayout());
                await useAppStore.getState().loadProjects();
              })
            }
          >
            Reload sidebar
          </button>
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
      {agentIds.map((agent) => {
        const group = grouped[agent];
        const visible = group.filter((p) => showHidden || !p.hidden);
        const collapsed = collapsedAgents.includes(agent);
        const available = status[agent]?.available;
        const pinned = agentLayout?.pinnedAgents.includes(agent) ?? false;
        return (
          <div key={agent} className="agent-group" data-agent-id={agent}>
            <div
              className={`agent-group-header ${available ? '' : 'unavailable'}${dragOverAgent === agent ? ' drag-over' : ''}`}
              draggable={!orderDisabled}
              onDragStart={(event) => {
                setDragId(null);
                setDragAgent(agent);
                event.dataTransfer.setData('text/plain', agent);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={clearDrag}
              onDragOver={(event) => {
                if (
                  orderDisabled ||
                  !dragAgent ||
                  dragAgent === agent ||
                  !sameAgentSection(dragAgent, agent)
                )
                  return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDragOverAgent(agent);
              }}
              onDragLeave={() =>
                setDragOverAgent((current) => (current === agent ? null : current))
              }
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const from = dragAgent;
                clearDrag();
                if (!orderDisabled && from && from !== agent && sameAgentSection(from, agent)) {
                  void runSidebarAction(() => moveAgent(from, agent));
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setCtxMenu(null);
                setAgentMenu({ x: event.clientX, y: event.clientY, agent });
              }}
              title={available ? agentName(agent) : `${agentName(agent)} (not installed)`}
            >
              <button
                type="button"
                className="agent-group-toggle"
                aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${agentName(agent)}`}
                aria-expanded={!collapsed}
                onClick={() => toggleAgentGroup(agent)}
              >
                <span className={`agent-group-caret ${collapsed ? 'collapsed' : ''}`}>▾</span>
                <AgentIcon
                  agent={agent}
                  size={18}
                  className={`agent-group-icon${agent === 'copilot' ? ' agent-group-icon-copilot' : ''}`}
                />
                <span className="agent-group-name">{agentName(agent)}</span>
                <span className="agent-group-count">{group.length}</span>
              </button>
              <button
                type="button"
                className={`sidebar-pin${pinned ? ' pinned' : ''}`}
                aria-label={`${pinned ? 'Unpin' : 'Pin'} ${agentName(agent)}`}
                aria-pressed={pinned}
                title={`${pinned ? 'Unpin' : 'Pin'} ${agentName(agent)}`}
                disabled={orderDisabled}
                draggable={false}
                onDragStart={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  void runSidebarAction(() => pinAgent(agent));
                }}
              >
                <ActionIcon name="pin" />
              </button>
              <button
                type="button"
                className="agent-quick-create"
                aria-label={`New project with ${agentName(agent)}`}
                title={
                  available
                    ? `New project with ${agentName(agent)}`
                    : `${agentName(agent)} is not installed`
                }
                disabled={!available || bulkDeleteBusy}
                draggable={false}
                onDragStart={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onNewProject(agent);
                }}
              >
                +
              </button>
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
                    draggable={!orderDisabled}
                    onDragStart={(e) => onDragStart(e, p)}
                    onDragEnd={clearDrag}
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
                      <div className="list-item-title">{p.displayName}</div>
                      <div className="list-item-sub">{p.realPath}</div>
                    </div>
                    <button
                      type="button"
                      className={`sidebar-pin${p.pinned ? ' pinned' : ''}`}
                      aria-label={`${p.pinned ? 'Unpin' : 'Pin'} project ${p.displayName}`}
                      aria-pressed={p.pinned}
                      title={`${p.pinned ? 'Unpin' : 'Pin'} project`}
                      disabled={orderDisabled}
                      draggable={false}
                      onDragStart={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        void runSidebarAction(() => pinProject(p.id, !p.pinned));
                      }}
                    >
                      <ActionIcon name="pin" />
                    </button>
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
          <button
            type="button"
            className="ctx-menu-item"
            disabled={orderDisabled}
            onClick={() => {
              const project = ctxMenu.project;
              void runSidebarAction(() => pinProject(project.id, !project.pinned));
              setCtxMenu(null);
            }}
          >
            {ctxMenu.project.pinned ? 'Unpin' : 'Pin to top'}
          </button>
          {([-1, 1] as const).map((direction) => {
            const project = ctxMenu.project;
            const target = adjacentProject(project, direction);
            return (
              <button
                type="button"
                key={direction}
                className="ctx-menu-item"
                disabled={orderDisabled || !target}
                onClick={() => {
                  setCtxMenu(null);
                  if (target)
                    void runSidebarAction(() =>
                      reorderProjects(project.agent, project.id, target.id),
                    );
                }}
              >
                {direction < 0 ? 'Move up' : 'Move down'}
              </button>
            );
          })}
          <div
            className="ctx-menu-item"
            onClick={() => {
              const project = ctxMenu.project;
              void runSidebarAction(() => hideProject(project.id, !project.hidden));
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
      {agentMenu && (
        <div
          className="ctx-menu"
          style={{ left: agentMenu.x, top: agentMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="ctx-menu-item"
            disabled={orderDisabled}
            onClick={() => {
              const agent = agentMenu.agent;
              setAgentMenu(null);
              void runSidebarAction(() => pinAgent(agent));
            }}
          >
            {agentLayout?.pinnedAgents.includes(agentMenu.agent) ? 'Unpin' : 'Pin to top'}
          </button>
          {([-1, 1] as const).map((direction) => {
            const agent = agentMenu.agent;
            const target = adjacentAgent(agent, direction);
            return (
              <button
                type="button"
                key={direction}
                className="ctx-menu-item"
                disabled={orderDisabled || !target}
                onClick={() => {
                  setAgentMenu(null);
                  if (target) void runSidebarAction(() => moveAgent(agent, target));
                }}
              >
                {direction < 0 ? 'Move up' : 'Move down'}
              </button>
            );
          })}
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
