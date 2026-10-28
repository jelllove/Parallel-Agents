import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/app-store';
import type { Project, AgentId, AgentInfo } from '../../shared/types';
import { orderedAgents } from '../../shared/sidebar-order';
import { AgentIcon } from './AgentIcon';
import { ProjectDeleteDialog } from './ProjectDeleteDialog';
import { canDeleteProject } from '../../shared/project-delete';
import { ActionIcon } from './ActionIcon';
import { SessionList } from './SessionList';
import { groupProjectTrees } from '../../shared/project-tree';
import type { ProjectTree } from '../../shared/project-tree';

export function ProjectList({ onNewProject }: { onNewProject: (agent: AgentId) => void }) {
  const projects = useAppStore((s) => s.projects);
  const refresh = useAppStore((s) => s.refreshProjectsAndAgents);
  const refreshing = useAppStore((s) => s.inventoryRefreshing);
  const inventoryError = useAppStore((s) => s.inventoryError);
  const selectedId = useAppStore((s) => s.selectedProjectId);
  const openProjectFromList = useAppStore((s) => s.openProjectFromList);
  const selectProject = useAppStore((s) => s.selectProject);
  const sessionGuideProjectId = useAppStore((s) => s.sessionGuideProjectId);
  const sessionGuideSeq = useAppStore((s) => s.sessionGuideSeq);
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
  const agentOrder = useAppStore((s) => s.agentOrder);
  const pinnedAgents = useAppStore((s) => s.pinnedAgents);
  const pinAgent = useAppStore((s) => s.pinAgent);
  const reorderAgentGroups = useAppStore((s) => s.reorderAgentGroups);
  const expandedProjects = useAppStore((s) => s.expandedProjects);
  const setProjectExpanded = useAppStore((s) => s.setProjectExpanded);
  const sidebarTreeLoaded = useAppStore((s) => s.sidebarTreeLoaded);
  const sidebarTreeLoading = useAppStore((s) => s.sidebarTreeLoading);
  const sidebarTreeError = useAppStore((s) => s.sidebarTreeError);
  const loadSidebarTree = useAppStore((s) => s.loadSidebarTree);
  const saveSidebarTree = useAppStore((s) => s.saveSidebarTree);
  const handledSelection = useRef({ id: selectedId, seq: sessionGuideSeq });
  const draggedAgent = useRef<AgentId | null>(null);
  const [agentDropTarget, setAgentDropTarget] = useState<{
    agent: AgentId;
    placement: 'before' | 'after';
  } | null>(null);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; project: Project } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const [cleanupMode, setCleanupMode] = useState(false);
  const [selectedMissingIds, setSelectedMissingIds] = useState<string[]>([]);
  const [confirmBulkIds, setConfirmBulkIds] = useState<string[] | null>(null);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [flashingProject, setFlashingProject] = useState<string | null>(null);
  const [openError, setOpenError] = useState('');

  const trees = useMemo(
    () =>
      cleanupMode
        ? projects
            .filter((p) => showHidden || !p.hidden)
            .map((p) => ({
              id: p.id,
              name: p.displayName,
              path: p.realPath,
              project: p,
              projects: [p],
              pinned: p.pinned,
            }))
        : groupProjectTrees(projects, showHidden),
    [projects, showHidden, cleanupMode],
  );
  const [agentMenu, setAgentMenu] = useState<{ x: number; y: number; agent: AgentId } | null>(null);
  const [sidebarError, setSidebarError] = useState('');
  const [sidebarBusy, setSidebarBusy] = useState(false);
  const actionBusy = useRef(false);
  const agentIds = orderedAgents({ agentOrder, pinnedAgents });
  const orderDisabled = sidebarBusy || !sidebarTreeLoaded || cleanupMode || bulkDeleteBusy;

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

  function sameAgentSection(from: AgentId, to: AgentId) {
    return pinnedAgents.includes(from) === pinnedAgents.includes(to);
  }

  async function moveAgent(from: AgentId, to: AgentId) {
    if (!sameAgentSection(from, to))
      throw new Error('Reorder agents within the same pinned section.');
    await reorderAgentGroups(
      from,
      to,
      agentIds.indexOf(from) < agentIds.indexOf(to) ? 'after' : 'before',
    );
  }

  function adjacentAgent(agent: AgentId, direction: number) {
    const group = agentIds.filter((id) => sameAgentSection(id, agent));
    return group[group.indexOf(agent) + direction];
  }

  function adjacentProject(project: Project, direction: number) {
    const group = trees
      .filter(
        (tree) =>
          tree.project.agent === project.agent &&
          tree.pinned ===
            trees.find((item) => item.projects.some((p) => p.id === project.id))?.pinned,
      )
      .map((tree) => tree.project);
    return group[group.findIndex((p) => p.id === project.id) + direction];
  }

  function clearDrag() {
    setDragId(null);
    setDragOverId(null);
    endAgentDrag();
  }

  const grouped = useMemo(() => {
    const out: Record<AgentId, ProjectTree[]> = {
      claude: [],
      codex: [],
      gemini: [],
      aider: [],
      copilot: [],
    };
    for (const tree of trees) out[tree.project.agent].push(tree);
    return out;
  }, [trees]);

  useEffect(() => {
    if (!sidebarTreeLoaded) return;
    if (
      handledSelection.current.id === selectedId &&
      handledSelection.current.seq === sessionGuideSeq
    )
      return;
    const tree = trees.find((item) => item.projects.some((p) => p.id === selectedId));
    if (selectedId && !tree) return;
    handledSelection.current = { id: selectedId, seq: sessionGuideSeq };
    if (tree) void setProjectExpanded(tree.id, true);
  }, [selectedId, sessionGuideSeq, trees, sidebarTreeLoaded, setProjectExpanded]);

  useEffect(() => {
    if (!sessionGuideProjectId || sessionGuideProjectId !== selectedId) return;
    const tree = trees.find((item) => item.projects.some((p) => p.id === sessionGuideProjectId));
    if (!tree) return;
    setFlashingProject(null);
    const raf = window.requestAnimationFrame(() => setFlashingProject(tree.id));
    const timer = window.setTimeout(() => setFlashingProject(null), 1050);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [selectedId, sessionGuideProjectId, sessionGuideSeq, trees]);

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
    return agents.find((agent) => agent.id === id)?.displayName ?? id;
  }

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

  async function handleClick(tree: ProjectTree) {
    void setProjectExpanded(tree.id, true);
    setOpenError('');
    try {
      if (tree.projects.length > 1) await selectProject(tree.project.id);
      else await openProjectFromList(tree.project.id);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    }
  }

  function handleContext(e: React.MouseEvent, p: Project) {
    e.preventDefault();
    setAgentMenu(null);
    setCtxMenu({ x: e.clientX, y: e.clientY, project: p });
  }

  function onDragStart(e: React.DragEvent, p: Project) {
    e.stopPropagation();
    draggedAgent.current = null;
    setAgentDropTarget(null);
    setDragId(p.id);
    e.dataTransfer.setData('text/plain', p.id);
    e.dataTransfer.effectAllowed = 'move';
  }

  function agentDropPlacement(event: React.DragEvent<HTMLElement>): 'before' | 'after' {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  }

  function endAgentDrag() {
    draggedAgent.current = null;
    setAgentDropTarget(null);
  }

  function onDragOver(e: React.DragEvent, target: Project) {
    const src = projects.find((x) => x.id === dragId);
    const sourceTree = trees.find((tree) => tree.projects.some((p) => p.id === src?.id));
    const targetTree = trees.find((tree) => tree.projects.some((p) => p.id === target.id));
    if (
      orderDisabled ||
      !src ||
      src.agent !== target.agent ||
      sourceTree?.pinned !== targetTree?.pinned ||
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
    const sourceTree = trees.find((tree) => tree.projects.some((p) => p.id === src?.id));
    const targetTree = trees.find((tree) => tree.projects.some((p) => p.id === target.id));
    clearDrag();
    if (
      orderDisabled ||
      !src ||
      src.agent !== target.agent ||
      sourceTree?.pinned !== targetTree?.pinned ||
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
      {installError && (
        <div className="inventory-error" role="alert">
          {installError}
        </div>
      )}
      {openError && (
        <div className="inventory-error" role="alert">
          {openError}
        </div>
      )}
      {sidebarTreeLoading && (
        <div className="list-item-sub session-notice" role="status">
          Loading sidebar layout...
        </div>
      )}
      {sidebarTreeError && (
        <div className="inventory-error" role="alert">
          {sidebarTreeError}
          <button
            className="project-action"
            onClick={() => void (sidebarTreeLoaded ? saveSidebarTree() : loadSidebarTree())}
          >
            Retry
          </button>
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
                await loadSidebarTree();
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
        const collapsed = collapsedAgents.includes(agent);
        const info = agents.find((item) => item.id === agent);
        const name = info?.displayName ?? agent;
        const missing = agentsChecked && status[agent]?.available === false;
        const available = status[agent]?.available;
        const pinned = pinnedAgents.includes(agent);
        return (
          <div key={agent} className="agent-group" data-agent-id={agent}>
            <div
              className={`agent-group-header${missing ? ' unavailable' : ''}${agentDropTarget?.agent === agent ? ` agent-drop-${agentDropTarget.placement}` : ''}`}
              data-agent={agent}
              aria-expanded={!collapsed}
              draggable={!orderDisabled}
              onClick={() => {
                if (sidebarTreeLoaded) void toggleAgentGroup(agent);
              }}
              onKeyDown={(event) => {
                if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                event.preventDefault();
                const up = event.key === 'ArrowUp';
                const target = adjacentAgent(agent, up ? -1 : 1);
                if (target && !orderDisabled)
                  void runSidebarAction(() =>
                    reorderAgentGroups(agent, target, up ? 'before' : 'after'),
                  );
              }}
              onDragStart={(event) => {
                setDragId(null);
                draggedAgent.current = agent;
                event.dataTransfer.setData('text/plain', agent);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={clearDrag}
              onDragOver={(event) => {
                if (
                  orderDisabled ||
                  !draggedAgent.current ||
                  draggedAgent.current === agent ||
                  !sameAgentSection(draggedAgent.current, agent)
                )
                  return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setAgentDropTarget({ agent, placement: agentDropPlacement(event) });
              }}
              onDragLeave={() =>
                setAgentDropTarget((current) => (current?.agent === agent ? null : current))
              }
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const from = draggedAgent.current;
                const placement = agentDropPlacement(event);
                clearDrag();
                if (!orderDisabled && from && from !== agent && sameAgentSection(from, agent)) {
                  void runSidebarAction(() => reorderAgentGroups(from, agent, placement));
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setCtxMenu(null);
                setAgentMenu({ x: event.clientX, y: event.clientY, agent });
              }}
              title={missing ? `${name} (not installed)` : name}
            >
              <button
                type="button"
                className="agent-group-toggle"
                disabled={!sidebarTreeLoaded}
                aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${name}${missing ? ' (not installed)' : ''}`}
                aria-expanded={!collapsed}
                aria-description="Drag to reorder within the pinned section. Or press Alt+ArrowUp or Alt+ArrowDown."
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                onClick={(event) => {
                  event.stopPropagation();
                  void toggleAgentGroup(agent);
                }}
              >
                <span className={`agent-group-caret ${collapsed ? 'collapsed' : ''}`}>▾</span>
                <AgentIcon
                  agent={agent}
                  size={14}
                  className={`agent-group-icon${agent === 'copilot' ? ' agent-group-icon-copilot' : ''}`}
                />
                <span className="agent-group-name">{name}</span>
                {missing && (
                  <span className="agent-missing" role="img" aria-label="Not installed">
                    ⚠️
                  </span>
                )}
                <span className="agent-group-count">{group.length}</span>
                <span
                  className="agent-drag-handle"
                  title="Drag to reorder; Alt+Up/Down when focused"
                >
                  <ActionIcon name="grip" />
                </span>
              </button>
              {missing && info && (
                <button
                  type="button"
                  className="agent-install"
                  aria-label={`Install ${name}`}
                  title={`Install ${name}: ${info.installHint}`}
                  draggable={false}
                  onDragStart={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    void openInstallGuide(info);
                  }}
                >
                  Install
                </button>
              )}
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
                {agent !== 'codex' && group.length === 0 && (
                  <div className="list-item-sub agent-group-empty">(none)</div>
                )}
                {group.map((tree) => {
                  const p = tree.project;
                  const selected = tree.projects.some((project) => project.id === selectedId);
                  const expanded = expandedProjects.includes(tree.id);
                  return (
                    <div
                      key={tree.id}
                      data-project-id={p.id}
                      className={`project-tree-node${selected ? ' selected' : ''}`}
                    >
                      <div
                        draggable={!orderDisabled}
                        data-project-row={p.id}
                        onDragStart={(e) => onDragStart(e, p)}
                        onDragEnd={() => {
                          setDragId(null);
                          setDragOverId(null);
                        }}
                        onDragOver={(e) => onDragOver(e, p)}
                        onDragLeave={() => setDragOverId((cur) => (cur === p.id ? null : cur))}
                        onDrop={(e) => onDrop(e, p)}
                        className={[
                          'list-item project-item',
                          selected ? 'active' : '',
                          !p.exists ? 'missing' : '',
                          p.hidden ? 'hidden-proj' : '',
                          dragOverId === p.id ? 'drag-over' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onContextMenu={(e) => handleContext(e, p)}
                        title={tree.path + (p.exists ? '' : ' (directory not found)')}
                      >
                        <button
                          className="project-caret"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${tree.name}`}
                          disabled={!sidebarTreeLoaded}
                          onClick={() => void setProjectExpanded(tree.id, !expanded)}
                        >
                          <span className="project-folder-icon">
                            <ActionIcon name="folder" />
                          </span>
                          <span className="project-chevron" aria-hidden="true">
                            {expanded ? '▾' : '▸'}
                          </span>
                        </button>
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
                        <button
                          className="project-open"
                          title={tree.path}
                          disabled={!sidebarTreeLoaded}
                          onClick={() => void handleClick(tree)}
                        >
                          <span className="project-text">
                            <span className="list-item-title">{tree.name}</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`sidebar-pin${tree.pinned ? ' pinned' : ''}`}
                          aria-label={`${tree.pinned ? 'Unpin' : 'Pin'} project ${tree.name}`}
                          aria-pressed={tree.pinned}
                          title={`${tree.pinned ? 'Unpin' : 'Pin'} project`}
                          disabled={orderDisabled}
                          draggable={false}
                          onDragStart={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            void runSidebarAction(async () => {
                              for (const member of tree.projects)
                                await pinProject(member.id, !tree.pinned);
                            });
                          }}
                        >
                          <ActionIcon name="pin" />
                        </button>
                      </div>
                      {expanded && (
                        <div
                          className={
                            flashingProject === tree.id ? 'sessions-guide-flash' : undefined
                          }
                        >
                          <SessionList projects={tree.projects} onProjectContext={handleContext} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {hiddenCount > 0 && (
        <button
          className="list-item project-hidden-toggle"
          style={{ fontStyle: 'italic', color: 'var(--text-dim)' }}
          disabled={!sidebarTreeLoaded}
          onClick={() => void setShowHidden(!showHidden)}
        >
          <span className="list-item-sub">
            {showHidden ? '▲ hide hidden' : `▼ show ${hiddenCount} hidden`}
          </span>
        </button>
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
            {pinnedAgents.includes(agentMenu.agent) ? 'Unpin' : 'Pin to top'}
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
