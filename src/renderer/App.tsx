import { useEffect, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useAppStore } from './store/app-store';
import { Sidebar } from './components/Sidebar';
import { TerminalTabs } from './components/TerminalTabs';
import { Explorer } from './components/Explorer';
import { StatusBar } from './components/StatusBar';
import { AboutDialog } from './components/AboutDialog';
import { ClaudeMissingBanner } from './components/ClaudeMissingBanner';
import { ClaudeIcon } from './components/ClaudeIcon';

export default function App() {
  const loadProjects = useAppStore((s) => s.loadProjects);
  const checkClaude = useAppStore((s) => s.checkClaude);
  const openTabs = useAppStore((s) => s.openTabs);
  const findProject = useAppStore((s) => s.findProject);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    loadProjects();
    checkClaude();
  }, [loadProjects, checkClaude]);

  useEffect(() => {
    const off = window.api.window.onFullscreenChange((on) => setFullscreen(on));
    return off;
  }, []);

  useEffect(() => {
    (window as unknown as { __getOpenTabs: () => string[] }).__getOpenTabs = () =>
      openTabs.map((id) => findProject(id)?.displayName ?? id);
  }, [openTabs, findProject]);

  return (
    <div className="app">
      {fullscreen && (
        <div className="app-header">
          <ClaudeIcon size={16} />
          <span>Parallel Agents</span>
        </div>
      )}
      <ClaudeMissingBanner />
      <div className="app-body">
        <PanelGroup direction="horizontal" autoSaveId="ccs-layout">
          <Panel defaultSize={20} minSize={14} maxSize={40}>
            <Sidebar onAbout={() => setAboutOpen(true)} />
          </Panel>
          <PanelResizeHandle className="resize-handle" />
          <Panel defaultSize={58} minSize={30}>
            <div className="middle">
              <TerminalTabs />
            </div>
          </Panel>
          <PanelResizeHandle className="resize-handle" />
          <Panel defaultSize={22} minSize={14} maxSize={45}>
            <Explorer />
          </Panel>
        </PanelGroup>
      </div>
      <StatusBar />
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  );
}
