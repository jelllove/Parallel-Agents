import { useAppStore } from '../store/app-store';

export function StatusBar() {
  const project = useAppStore((s) =>
    s.projects.find((p) => p.id === (s.activeTabId ?? s.selectedProjectId)),
  );
  const openTabs = useAppStore((s) => s.openTabs);

  return (
    <div className="status-bar">
      <span className="item">Mode: Ready</span>
      <span className="item">Tabs: {openTabs.length}</span>
      <span className="spacer" />
      {project && <span className="item">{project.realPath}</span>}
    </div>
  );
}
