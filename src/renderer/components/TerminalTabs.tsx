import { useEffect, useState } from 'react';
import { useAppStore } from '../store/app-store';
import { TerminalPane } from './TerminalPane';
import { CloseTabConfirmDialog } from './CloseTabConfirmDialog';
import { agentIconUrl } from '../icons/agentIcons';
import type { AgentId, Project } from '../../shared/types';

export function TerminalTabs() {
  const openTabs = useAppStore((s) => s.openTabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const findProject = useAppStore((s) => s.findProject);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTabs = useAppStore((s) => s.closeTabs);
  const consumePendingCommand = useAppStore((s) => s.consumePendingCommand);
  const tabAgent = useAppStore((s) => s.tabAgent);
  const tabRespawnNonce = useAppStore((s) => s.tabRespawnNonce);
  const confirmOnCloseTab = useAppStore((s) => s.confirmOnCloseTab);
  const setConfirmOnCloseTab = useAppStore((s) => s.setConfirmOnCloseTab);
  const reorderTabs = useAppStore((s) => s.reorderTabs);

  const [pending, setPending] = useState<{
    ids: string[];
    title: string;
    message: string;
    confirmText: string;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const tabProjects = openTabs.map((id) => findProject(id)).filter(Boolean) as Project[];

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    window.addEventListener('blur', closeMenu);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('blur', closeMenu);
    };
  }, [contextMenu]);

  function requestClose(ids: string[]) {
    if (ids.length === 0) return;
    if (!confirmOnCloseTab) {
      closeTabs(ids);
      return;
    }
    if (ids.length === 1) {
      const project = findProject(ids[0]);
      setPending({
        ids,
        title: 'Close this tab?',
        message: `The tab "${project?.displayName ?? ids[0]}" will be closed. Any running CLI process in this tab will also stop.`,
        confirmText: 'Close tab',
      });
      return;
    }
    setPending({
      ids,
      title: `Close ${ids.length} tabs?`,
      message: `This will terminate all ${ids.length} running agent sessions.`,
      confirmText: 'Close tabs',
    });
  }

  function handleCloseClick(p: Project, e: React.MouseEvent) {
    e.stopPropagation();
    requestClose([p.id]);
  }

  function onDragStart(e: React.DragEvent, p: Project) {
    setDragId(p.id);
    e.dataTransfer.setData('text/plain', p.id);
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e: React.DragEvent, target: Project) {
    if (!dragId || dragId === target.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(target.id);
  }
  function onDragLeave(target: Project) {
    setDragOverId((cur) => (cur === target.id ? null : cur));
  }
  function onDrop(e: React.DragEvent, target: Project) {
    e.preventDefault();
    const src = dragId;
    setDragId(null);
    setDragOverId(null);
    if (!src || src === target.id) return;
    reorderTabs(src, target.id);
  }

  return (
    <>
      <div className="tab-bar" onClick={() => setContextMenu(null)}>
        {tabProjects.map((p) => {
          const ag: AgentId = tabAgent[p.id] ?? 'claude';
          return (
            <div
              key={p.id}
              draggable
              onDragStart={(e) => onDragStart(e, p)}
              onDragOver={(e) => onDragOver(e, p)}
              onDragLeave={() => onDragLeave(p)}
              onDrop={(e) => onDrop(e, p)}
              className={[
                'tab',
                activeTabId === p.id ? 'active' : '',
                dragOverId === p.id ? 'drag-over' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setActiveTab(p.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ x: event.clientX, y: event.clientY, id: p.id });
              }}
              title={`${p.realPath} · ${ag}`}
            >
              <img src={agentIconUrl(ag)} className="tab-icon" width={16} height={16} alt="" draggable={false} />
              <span>{p.displayName}</span>
              <span
                className="close"
                onClick={(e) => handleCloseClick(p, e)}
              >
                ×
              </span>
            </div>
          );
        })}
      </div>
      {contextMenu && (
        <div
          className="ctx-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className="ctx-menu-item"
            onClick={() => {
              requestClose([contextMenu.id]);
              setContextMenu(null);
            }}
          >
            Close
          </div>
          <div
            className={`ctx-menu-item${openTabs.length <= 1 ? ' disabled' : ''}`}
            onClick={() => {
              requestClose(openTabs.filter((id) => id !== contextMenu.id));
              setContextMenu(null);
            }}
          >
            Close Others
          </div>
          <div
            className="ctx-menu-item"
            onClick={() => {
              requestClose(openTabs);
              setContextMenu(null);
            }}
          >
            Close All
          </div>
        </div>
      )}
      <div className="terminal-host">
        {openTabs.length === 0 ? (
          <div className="empty-state">
            Click <b>+ New Project</b> to pick a folder and launch an agent CLI.
            <br />Or select a project on the left to see its history.
          </div>
        ) : (
          openTabs.map((id) => {
            const p = findProject(id);
            if (!p) return null;
            const pendingCmd = consumePendingCommand(id);
            const nonce = tabRespawnNonce[id] ?? 0;
            return (
              <TerminalPane
                key={`${id}#${nonce}`}
                projectId={id}
                cwd={p.realPath}
                visible={activeTabId === id}
                initialCommand={pendingCmd?.command}
                extraPath={pendingCmd?.extraPath}
              />
            );
          })
        )}
      </div>
      {pending && (
        <CloseTabConfirmDialog
          title={pending.title}
          message={pending.message}
          confirmText={pending.confirmText}
          onConfirm={(dontAsk) => {
            if (dontAsk) void setConfirmOnCloseTab(false);
            closeTabs(pending.ids);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
