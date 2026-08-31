import { useEffect, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useAppStore } from '../store/app-store';
import { ProjectList } from './ProjectList';
import { SessionList } from './SessionList';
import { AgentPicker } from './AgentPicker';
import { startCommandFor, extraPathFor } from '../icons/agentIcons';
import type { AgentId } from '../../shared/types';

interface Props {
  onAbout: () => void;
}

export function Sidebar({ onAbout }: Props) {
  const newSessionFromDialog = useAppStore((s) => s.newSessionFromDialog);
  const refreshProjectsAndAgents = useAppStore((s) => s.refreshProjectsAndAgents);
  const inventoryRefreshing = useAppStore((s) => s.inventoryRefreshing);
  const inventoryError = useAppStore((s) => s.inventoryError);
  const agents = useAppStore((s) => s.agents);
  const status = useAppStore((s) => s.agentStatus);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const sessionGuideProjectId = useAppStore((s) => s.sessionGuideProjectId);
  const sessionGuideSeq = useAppStore((s) => s.sessionGuideSeq);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [sessionsFlashing, setSessionsFlashing] = useState(false);

  function handleNew(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPicker({ x: rect.right + 4, y: rect.top });
  }

  async function onPick(id: AgentId) {
    setPicker(null);
    await newSessionFromDialog(id, startCommandFor(id), extraPathFor(status[id]?.path));
  }

  useEffect(() => {
    if (!sessionGuideProjectId || sessionGuideProjectId !== selectedProjectId) return;
    setSessionsFlashing(false);
    const raf = window.requestAnimationFrame(() => setSessionsFlashing(true));
    const timer = window.setTimeout(() => setSessionsFlashing(false), 1050);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [selectedProjectId, sessionGuideProjectId, sessionGuideSeq]);

  return (
    <div className="sidebar">
      <button className="btn-primary" onClick={handleNew}>
        <span className="btn-plus">+</span>
        <span>New Project</span>
      </button>
      <div className="sidebar-split">
        <PanelGroup direction="vertical" autoSaveId="parallel-agents-sidebar-layout">
          <Panel defaultSize={60} minSize={20}>
            <div className="sidebar-section scrollable">
              <div className="sidebar-title section-projects">
                <span className="section-glyph">▣</span>
                <span>Projects</span>
              </div>
              <div className="sidebar-actions">
                <button
                  className="btn-secondary sidebar-refresh-btn"
                  disabled={inventoryRefreshing}
                  title="Refresh all agents and project status"
                  onClick={() => void refreshProjectsAndAgents()}
                >
                  {inventoryRefreshing ? '↻ Refreshing…' : '↻ Refresh Projects & Agents'}
                </button>
                {inventoryError && (
                  <div className="inventory-error" role="alert" title={inventoryError}>
                    Inventory action failed: {inventoryError}
                  </div>
                )}
              </div>
              <ProjectList />
            </div>
          </Panel>
          <PanelResizeHandle className="resize-handle-h" />
          <Panel defaultSize={40} minSize={15}>
            <div className={`sidebar-section scrollable sessions${sessionsFlashing ? ' sessions-guide-flash' : ''}`}>
              <div className="sidebar-title section-sessions">
                <span className="section-glyph">⏱</span>
                <span>Recent Sessions</span>
              </div>
              <SessionList />
            </div>
          </Panel>
        </PanelGroup>
      </div>
      <button className="sidebar-about" onClick={onAbout} title="About">
        <span className="section-glyph about-glyph">i</span>
        <span>About</span>
      </button>
      {picker && agents.length > 0 && (
        <AgentPicker
          agents={agents}
          status={status}
          onPick={onPick}
          onClose={() => setPicker(null)}
          anchorX={picker.x}
          anchorY={picker.y}
          title="Pick an agent CLI"
        />
      )}
    </div>
  );
}
