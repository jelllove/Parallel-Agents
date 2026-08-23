import { useMemo, useState } from 'react';
import { useAppStore } from '../store/app-store';
import type { Project, AgentId } from '../../shared/types';
import { folderIconUrl } from '../icons/iconResolver';
import { agentIconUrl, startCommandFor, extraPathFor } from '../icons/agentIcons';
import { ConfirmDialog } from './ConfirmDialog';

const TREE_AGENTS: AgentId[] = ['copilot', 'codex', 'claude', 'gemini', 'aider'];

function canDeleteProject(agent: AgentId): boolean {
  return agent === 'claude' || agent === 'gemini' || agent === 'copilot';
}

function deleteMessageFor(project: Project): string {
  if (project.agent === 'claude') {
    return `This will permanently delete ~/.claude/projects/${project.dirName}/ and all its sessions. The actual working directory on disk is not touched.`;
  }
  if (project.agent === 'gemini') {
    return `This will permanently delete ~/.gemini/tmp/${project.dirName}/ and all its sessions. The actual working directory on disk is not touched.`;
  }
  if (project.agent === 'copilot') {
    return `This will permanently delete Copilot session history for "${project.realPath}" from ~/.copilot/session-state/. The actual working directory on disk is not touched.`;
  }
  return `Delete is not supported for ${project.agent} projects.`;
}

export function ProjectList() {
  const projects = useAppStore((s) => s.projects);
  const selectedId = useAppStore((s) => s.selectedProjectId);
  const selectProject = useAppStore((s) => s.selectProject);
  const openTabWithAgent = useAppStore((s) => s.openTabWithAgent);
  const openTabs = useAppStore((s) => s.openTabs);
  const pinProject = useAppStore((s) => s.pinProject);
  const hideProject = useAppStore((s) => s.hideProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const reorderProjects = useAppStore((s) => s.reorderProjects);
  const showHidden = useAppStore((s) => s.showHidden);
  const setShowHidden = useAppStore((s) => s.setShowHidden);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const agents = useAppStore((s) => s.agents);
  const status = useAppStore((s) => s.agentStatus);
  const collapsedAgents = useAppStore((s) => s.collapsedAgents);
  const toggleAgentGroup = useAppStore((s) => s.toggleAgentGroup);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; project: Project } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const out: Record<AgentId, Project[]> = {
      claude: [], codex: [], gemini: [], aider: [], copilot: [],
    };
    for (const p of projects) out[p.agent].push(p);
    return out;
  }, [projects]);

  const hiddenCount = useMemo(
    () => projects.filter((p) => p.hidden).length,
    [projects],
  );

  function agentName(id: AgentId): string {
    return agents.find((a) => a.id === id)?.displayName ?? id;
  }

  async function handleClick(p: Project) {
    selectProject(p.id);
    if (!p.exists) return;
    if (openTabs.includes(p.id)) {
      setActiveTab(p.id);
      return;
    }
    await openTabWithAgent(
      p.id,
      p.agent,
      startCommandFor(p.agent),
      extraPathFor(status[p.agent]?.path),
    );
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
              <img src={agentIconUrl(agent)} className="agent-group-icon" alt="" draggable={false} />
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
                  <div
                    key={p.id}
                    draggable
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
                    ].filter(Boolean).join(' ')}
                    onClick={() => handleClick(p)}
                    onContextMenu={(e) => handleContext(e, p)}
                    title={p.realPath + (p.exists ? '' : ' (directory not found)')}
                  >
                    <img
                      className="project-icon"
                      src={folderIconUrl(p.displayName, selectedId === p.id)}
                      alt=""
                      draggable={false}
                    />
                    <div className="project-text">
                      <div className="list-item-title">
                        {p.pinned ? '📌 ' : ''}{p.displayName}
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
        <ConfirmDialog
          title={`Delete project "${confirmDelete.displayName}"?`}
          message={deleteMessageFor(confirmDelete)}
          confirmText="Delete forever"
          typeToConfirm={confirmDelete.displayName}
          destructive
          onConfirm={async () => {
            const p = confirmDelete;
            setConfirmDelete(null);
            await deleteProject(p.id);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
