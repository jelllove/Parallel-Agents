import { useAppStore } from '../store/app-store';
import { TerminalPane } from './TerminalPane';
import { ClaudeIcon } from './ClaudeIcon';


export function TerminalTabs() {
  const openTabs = useAppStore((s) => s.openTabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const findProject = useAppStore((s) => s.findProject);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const consumePendingCommand = useAppStore((s) => s.consumePendingCommand);

  const tabProjects = openTabs.map((id) => findProject(id)).filter(Boolean);

  return (
    <>
      <div className="tab-bar">
        {tabProjects.map((p) => (
          <div
            key={p!.id}
            className={`tab ${activeTabId === p!.id ? 'active' : ''}`}
            onClick={() => setActiveTab(p!.id)}
            title={p!.realPath}
          >
            <ClaudeIcon className="tab-icon" />
            <span>{p!.displayName}</span>
            <span
              className="close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(p!.id);
              }}
            >
              ×
            </span>
          </div>
        ))}
      </div>
      <div className="terminal-host">
        {openTabs.length === 0 ? (
          <div className="empty-state">
            Click <b>+ New Project</b> to pick a folder and launch a Claude terminal.
            <br />Or select a project on the left to see its history.
          </div>
        ) : (
          openTabs.map((id) => {
            const p = findProject(id);
            if (!p) return null;
            return (
              <TerminalPane
                key={id}
                projectId={id}
                cwd={p.realPath}
                visible={activeTabId === id}
                initialCommand={consumePendingCommand(id)}
              />
            );
          })
        )}
      </div>
    </>
  );
}
