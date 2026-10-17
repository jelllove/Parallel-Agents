import { useState } from 'react';
import { useAppStore } from '../store/app-store';
import { ProjectList } from './ProjectList';
import { AgentPicker } from './AgentPicker';
import { NewProjectDialog } from './NewProjectDialog';
import type { AgentId } from '../../shared/types';

interface Props {
  onAbout: () => void;
}

export function Sidebar({ onAbout }: Props) {
  const agents = useAppStore((s) => s.agents);
  const status = useAppStore((s) => s.agentStatus);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [newProjectAgent, setNewProjectAgent] = useState<AgentId | null>(null);

  function handleNew(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPicker({ x: rect.right + 4, y: rect.top });
  }

  function onPick(id: AgentId) {
    setPicker(null);
    setNewProjectAgent(id);
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
        <ProjectList onNewProject={setNewProjectAgent} />
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
      {newProjectAgent && (
        <NewProjectDialog agent={newProjectAgent} onClose={() => setNewProjectAgent(null)} />
      )}
    </div>
  );
}
