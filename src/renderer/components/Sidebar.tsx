import { useState } from 'react';
import { useAppStore } from '../store/app-store';
import { ProjectList } from './ProjectList';
import { AgentPicker } from './AgentPicker';
import { NewProjectDialog } from './NewProjectDialog';
import type { AgentId, Project } from '../../shared/types';

interface Props {
  onAbout: () => void;
}

export function Sidebar({ onAbout }: Props) {
  const agents = useAppStore((s) => s.agents);
  const status = useAppStore((s) => s.agentStatus);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [creation, setCreation] = useState<{ agent: AgentId; project?: Project } | null>(null);

  function handleNew(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPicker({ x: rect.right + 4, y: rect.top });
  }

  function onPick(id: AgentId) {
    setPicker(null);
    setCreation({ agent: id });
  }

  return (
    <div className="sidebar">
      <button className="btn-primary" onClick={handleNew}>
        <span className="btn-plus">+</span>
        <span>New Project</span>
      </button>
      <div className="sidebar-section scrollable project-tree">
        <div className="sidebar-title section-projects">
          <span>Projects</span>
        </div>
        <ProjectList onNewProject={(agent, project) => setCreation({ agent, project })} />
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
      {creation && (
        <NewProjectDialog
          agent={creation.agent}
          sourceProject={creation.project}
          onClose={() => setCreation(null)}
        />
      )}
    </div>
  );
}
