import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/app-store';
import { TerminalPane } from './TerminalPane';
import { CloseTabConfirmDialog } from './CloseTabConfirmDialog';
import { agentIconUrl } from '../icons/agentIcons';
import type { AgentId, Project } from '../../shared/types';
import type { SessionShellProfile } from '../../shared/session-terminals';
import { agentTerminalKey, sessionTabLabelSuffix, shellTerminalKey } from '../../shared/session-terminals';

interface TabEntry {
  tabId: string;
  project: Project;
  sessionId: string | null;
  label: string;
}

export function TerminalTabs() {
  const openTabs = useAppStore((s) => s.openTabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabProjectId = useAppStore((s) => s.tabProjectId);
  const tabSessionId = useAppStore((s) => s.tabSessionId);
  const findProject = useAppStore((s) => s.findProject);
  const sessionsByProject = useAppStore((s) => s.sessions);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTabs = useAppStore((s) => s.closeTabs);
  const consumePendingCommand = useAppStore((s) => s.consumePendingCommand);
  const tabAgent = useAppStore((s) => s.tabAgent);
  const tabRespawnNonce = useAppStore((s) => s.tabRespawnNonce);
  const tabShellProfile = useAppStore((s) => s.tabShellProfile);
  const tabShellOpened = useAppStore((s) => s.tabShellOpened);
  const tabShellVisible = useAppStore((s) => s.tabShellVisible);
  const openShellForTab = useAppStore((s) => s.openShellForTab);
  const setTabShellVisible = useAppStore((s) => s.setTabShellVisible);
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

  const tabEntries = useMemo<TabEntry[]>(() => {
    return openTabs.flatMap((tabId) => {
      const projectId = tabProjectId[tabId] ?? tabId;
      const project = findProject(projectId);
      if (!project) return [];

      const sessionId = tabSessionId[tabId] ?? null;
      if (!sessionId) {
        return [{
          tabId,
          project,
          sessionId: null,
          label: project.displayName,
        }];
      }

      const session = (sessionsByProject[projectId] ?? []).find((item) => item.id === sessionId);
      const suffix = sessionTabLabelSuffix(session?.title ?? '', sessionId);
      return [{
        tabId,
        project,
        sessionId,
        label: `${project.displayName} · ${suffix}`,
      }];
    });
  }, [openTabs, tabProjectId, findProject, tabSessionId, sessionsByProject]);
  const tabEntryById = useMemo(
    () => new Map(tabEntries.map((entry) => [entry.tabId, entry])),
    [tabEntries],
  );
  const isWindows = navigator.userAgent.toLowerCase().includes('windows');

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
      const entry = tabEntryById.get(ids[0]);
      setPending({
        ids,
        title: 'Close this tab?',
        message: `The tab "${entry?.label ?? ids[0]}" will be closed. Any running CLI process in this tab will also stop.`,
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

  function handleCloseClick(tabId: string, e: React.MouseEvent) {
    e.stopPropagation();
    requestClose([tabId]);
  }

  function onDragStart(e: React.DragEvent, tabId: string) {
    setDragId(tabId);
    e.dataTransfer.setData('text/plain', tabId);
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e: React.DragEvent, targetTabId: string) {
    if (!dragId || dragId === targetTabId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(targetTabId);
  }
  function onDragLeave(targetTabId: string) {
    setDragOverId((cur) => (cur === targetTabId ? null : cur));
  }
  function onDrop(e: React.DragEvent, targetTabId: string) {
    e.preventDefault();
    const src = dragId;
    setDragId(null);
    setDragOverId(null);
    if (!src || src === targetTabId) return;
    reorderTabs(src, targetTabId);
  }

  return (
    <>
      <div className="tab-bar" onClick={() => setContextMenu(null)}>
        {tabEntries.map((entry) => {
          const ag: AgentId = tabAgent[entry.tabId] ?? entry.project.agent;
          return (
            <div
              key={entry.tabId}
              draggable
              onDragStart={(e) => onDragStart(e, entry.tabId)}
              onDragOver={(e) => onDragOver(e, entry.tabId)}
              onDragLeave={() => onDragLeave(entry.tabId)}
              onDrop={(e) => onDrop(e, entry.tabId)}
              className={[
                'tab',
                activeTabId === entry.tabId ? 'active' : '',
                dragOverId === entry.tabId ? 'drag-over' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setActiveTab(entry.tabId)}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ x: event.clientX, y: event.clientY, id: entry.tabId });
              }}
              title={[
                entry.project.realPath,
                ag,
                entry.sessionId ?? null,
              ].filter(Boolean).join(' · ')}
            >
              <img src={agentIconUrl(ag)} className="tab-icon" width={16} height={16} alt="" draggable={false} />
              <span>{entry.label}</span>
              <span
                className="close"
                onClick={(e) => handleCloseClick(entry.tabId, e)}
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
          <div className="ctx-menu-divider" />
          {isWindows ? (
            <>
              <div
                className="ctx-menu-item"
                onClick={() => {
                  openShellForTab(contextMenu.id, 'powershell');
                  setContextMenu(null);
                }}
              >
                Open Shell (PowerShell)
              </div>
              <div
                className="ctx-menu-item"
                onClick={() => {
                  openShellForTab(contextMenu.id, 'bash');
                  setContextMenu(null);
                }}
              >
                Open Shell (Bash)
              </div>
              <div
                className="ctx-menu-item"
                onClick={() => {
                  openShellForTab(contextMenu.id, 'cmd');
                  setContextMenu(null);
                }}
              >
                Open Shell (CMD)
              </div>
            </>
          ) : (
            <div
              className="ctx-menu-item"
              onClick={() => {
                openShellForTab(contextMenu.id, 'default');
                setContextMenu(null);
              }}
            >
              Open Shell
            </div>
          )}
        </div>
      )}
      <div className="terminal-host">
        {openTabs.length === 0 ? (
          <div className="empty-state">
            Click <b>+ New Project</b> to pick a folder and launch an agent CLI.
            <br />Or select a project on the left to see its history.
          </div>
        ) : (
          <>
            {activeTabId && (
              <div className="terminal-shell-toolbar">
                <button
                  className="terminal-shell-toggle"
                  onClick={() => {
                    if (tabShellVisible[activeTabId]) {
                      setTabShellVisible(activeTabId, false);
                    } else {
                      openShellForTab(activeTabId);
                    }
                  }}
                >
                  {tabShellVisible[activeTabId] ? 'Hide Shell' : 'Show Shell'}
                </button>
                {tabShellOpened[activeTabId] && (
                  <span className="terminal-shell-meta">
                    {tabShellProfile[activeTabId] ?? 'default'}
                  </span>
                )}
              </div>
            )}
            <div className="terminal-panels">
              {tabEntries.map((entry) => {
                const pendingCmd = consumePendingCommand(entry.tabId);
                const nonce = tabRespawnNonce[entry.tabId] ?? 0;
                const profile: SessionShellProfile = tabShellProfile[entry.tabId] ?? 'default';
                const agentKey = agentTerminalKey(entry.tabId);
                const shellKey = shellTerminalKey(entry.tabId, profile);
                const isActive = activeTabId === entry.tabId;
                const isShellVisible = tabShellVisible[entry.tabId] ?? false;
                return (
                  <div key={entry.tabId} className={`terminal-tab-panel ${isActive ? 'active' : ''}`}>
                    <div className="terminal-stack">
                      <div className="terminal-agent-pane">
                        <TerminalPane
                          key={`${agentKey}#${nonce}`}
                          terminalKey={agentKey}
                          cwd={entry.project.realPath}
                          visible={isActive}
                          initialCommand={pendingCmd?.command}
                          extraPath={pendingCmd?.extraPath}
                        />
                      </div>
                      {tabShellOpened[entry.tabId] && (
                        <div className={`terminal-shell-pane ${isShellVisible ? '' : 'hidden'}`}>
                          <TerminalPane
                            key={shellKey}
                            terminalKey={shellKey}
                            cwd={entry.project.realPath}
                            visible={isActive && isShellVisible}
                            shellProfile={profile}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
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
