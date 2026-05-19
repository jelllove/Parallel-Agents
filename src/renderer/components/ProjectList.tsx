import { useState } from 'react';
import { useAppStore } from '../store/app-store';
import type { Project } from '../../shared/types';
import { folderIconUrl } from '../icons/iconResolver';

export function ProjectList() {
  const projects = useAppStore((s) => s.projects);
  const selectedId = useAppStore((s) => s.selectedProjectId);
  const selectProject = useAppStore((s) => s.selectProject);
  const openTab = useAppStore((s) => s.openTab);
  const openTabs = useAppStore((s) => s.openTabs);
  const pinProject = useAppStore((s) => s.pinProject);
  const hideProject = useAppStore((s) => s.hideProject);
  const showHidden = useAppStore((s) => s.showHidden);
  const setShowHidden = useAppStore((s) => s.setShowHidden);
  const queueClaudeOnOpen = useAppStore((s) => s.queueClaudeOnOpen);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; project: Project } | null>(null);

  const visible = projects.filter((p) => showHidden || !p.hidden);
  const hiddenCount = projects.filter((p) => p.hidden).length;

  function handleClick(p: Project) {
    selectProject(p.id);
    if (p.exists) {
      const firstTime = !openTabs.includes(p.id);
      if (firstTime) queueClaudeOnOpen(p.id);
      openTab(p.id);
    }
  }

  function handleContext(e: React.MouseEvent, p: Project) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, project: p });
  }

  return (
    <div onClick={() => setCtxMenu(null)}>
      {visible.map((p) => (
        <div
          key={p.id}
          className={[
            'list-item project-item',
            selectedId === p.id ? 'active' : '',
            !p.exists ? 'missing' : '',
            p.hidden ? 'hidden-proj' : '',
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
        </div>
      )}
    </div>
  );
}
