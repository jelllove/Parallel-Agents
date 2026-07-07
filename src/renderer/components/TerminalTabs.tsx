import { useState } from 'react';
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
  const closeTab = useAppStore((s) => s.closeTab);
  const consumePendingCommand = useAppStore((s) => s.consumePendingCommand);
  const tabAgent = useAppStore((s) => s.tabAgent);
  const tabRespawnNonce = useAppStore((s) => s.tabRespawnNonce);
  const confirmOnCloseTab = useAppStore((s) => s.confirmOnCloseTab);
  const setConfirmOnCloseTab = useAppStore((s) => s.setConfirmOnCloseTab);
  const reorderTabs = useAppStore((s) => s.reorderTabs);

  const [pending, setPending] = useState<{ id: string; name: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const tabProjects = openTabs.map((id) => findProject(id)).filter(Boolean) as Project[];

  function handleCloseClick(p: Project, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirmOnCloseTab) { closeTab(p.id); return; }
    setPending({ id: p.id, name: p.displayName });
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
      <div className="tab-bar">
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
          projectName={pending.name}
          onConfirm={(dontAsk) => {
            if (dontAsk) void setConfirmOnCloseTab(false);
            closeTab(pending.id);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
