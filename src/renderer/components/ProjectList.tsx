import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/app-store';
import type { Project, AgentId } from '../../shared/types';
import { AgentIcon } from './AgentIcon';
import { ProjectDeleteDialog } from './ProjectDeleteDialog';
import { canDeleteProject } from '../../shared/project-delete';
import { ActionIcon } from './ActionIcon';
import { SessionList } from './SessionList';
import { groupProjectTrees } from '../../shared/project-tree';
import type { ProjectTree } from '../../shared/project-tree';

export function ProjectList() {
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
  const collapsedAgents = useAppStore((s) => s.collapsedAgents);
  const toggleAgentGroup = useAppStore((s) => s.toggleAgentGroup);
  const agentOrder = useAppStore((s) => s.agentOrder);
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
            }))
        : groupProjectTrees(projects, showHidden),
    [projects, showHidden, cleanupMode],
  );

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
    return agents.find((a) => a.id === id)?.displayName ?? id;
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
    setCtxMenu({ x: e.clientX, y: e.clientY, project: p });
  }

  function onDragStart(e: React.DragEvent, p: Project) {
    draggedAgent.current = null;
    setAgentDropTarget(null);
    setDragId(p.id);
    e.dataTransfer.setData('text/plain', p.id);
    e.dataTransfer.effectAllowed = 'move';
  }

  function agentDropPlacement(event: React.DragEvent<HTMLButtonElement>): 'before' | 'after' {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  }

  function endAgentDrag() {
    draggedAgent.current = null;
    setAgentDropTarget(null);
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
    setOpenError('');
    try {
      await reorderProjects(target.agent, src.id, target.id);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    }
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
      {agentOrder.map((agent) => {
        const group = grouped[agent];
        const collapsed = collapsedAgents.includes(agent);
        const available = status[agent]?.available;
        return (
          <div key={agent} className="agent-group">
            <button
              className={`agent-group-header ${available ? '' : 'unavailable'}${agentDropTarget?.agent === agent ? ` agent-drop-${agentDropTarget.placement}` : ''}`}
              data-agent={agent}
              disabled={!sidebarTreeLoaded}
              draggable={sidebarTreeLoaded}
              onDragStart={(event) => {
                draggedAgent.current = agent;
                setDragId(null);
                setDragOverId(null);
                event.dataTransfer.setData('application/x-parallel-agents-agent', agent);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                if (!draggedAgent.current || draggedAgent.current === agent) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setAgentDropTarget({ agent, placement: agentDropPlacement(event) });
              }}
              onDragLeave={(event) => {
                if (
                  event.relatedTarget instanceof Node &&
                  event.currentTarget.contains(event.relatedTarget)
                )
                  return;
                setAgentDropTarget((target) => (target?.agent === agent ? null : target));
              }}
              onDrop={(event) => {
                const source = draggedAgent.current;
                if (!source) return;
                event.preventDefault();
                const placement = agentDropPlacement(event);
                endAgentDrag();
                void reorderAgentGroups(source, agent, placement);
              }}
              onDragEnd={endAgentDrag}
              aria-description="Drag to reorder. Or press Alt+ArrowUp or Alt+ArrowDown."
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              onKeyDown={(event) => {
                if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                event.preventDefault();
                const up = event.key === 'ArrowUp';
                const target = agentOrder[agentOrder.indexOf(agent) + (up ? -1 : 1)];
                if (target) void reorderAgentGroups(agent, target, up ? 'before' : 'after');
              }}
              aria-expanded={!collapsed}
              onClick={() => void toggleAgentGroup(agent)}
              title={available ? agentName(agent) : `${agentName(agent)} (not installed)`}
            >
              <AgentIcon
                agent={agent}
                size={14}
                className={`agent-group-icon${agent === 'copilot' ? ' agent-group-icon-copilot' : ''}`}
              />
              <span className="agent-group-name">{agentName(agent)}</span>
              <span className="agent-group-count">{group.length}</span>
              <span className="agent-drag-handle" title="Drag to reorder; Alt+Up/Down when focused">
                <ActionIcon name="grip" />
              </span>
              <span
                className={`agent-group-caret ${collapsed ? 'collapsed' : ''}`}
                aria-hidden="true"
              >
                ▾
              </span>
            </button>
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
                      className={`project-tree-node${selected ? ' selected' : ''}`}
                    >
                      <div
                        draggable={!cleanupMode}
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
                            <span className="list-item-title">
                              {p.pinned ? '📌 ' : ''}
                              {tree.name}
                            </span>
                          </span>
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
