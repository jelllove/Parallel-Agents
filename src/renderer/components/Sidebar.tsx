import { useAppStore } from '../store/app-store';
import { ProjectList } from './ProjectList';
import { SessionList } from './SessionList';

interface Props {
  onAbout: () => void;
}

export function Sidebar({ onAbout }: Props) {
  const newSessionFromDialog = useAppStore((s) => s.newSessionFromDialog);

  return (
    <div className="sidebar">
      <button className="btn-primary" onClick={() => newSessionFromDialog()}>
        <span className="btn-plus">+</span>
        <span>New Project</span>
      </button>
      <div className="sidebar-section scrollable">
        <div className="sidebar-title section-projects">
          <span className="section-glyph">▣</span>
          <span>Projects</span>
        </div>
        <ProjectList />
      </div>
      <div className="sidebar-section scrollable sessions">
        <div className="sidebar-title section-sessions">
          <span className="section-glyph">⏱</span>
          <span>Recent Sessions</span>
        </div>
        <SessionList />
      </div>
      <button className="sidebar-about" onClick={onAbout} title="About">
        <span className="section-glyph about-glyph">i</span>
        <span>About</span>
      </button>
    </div>
  );
}
