import { Fragment, useEffect, useMemo, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useAppStore } from './store/app-store';
import { Sidebar } from './components/Sidebar';
import { TerminalTabs } from './components/TerminalTabs';
import { Explorer } from './components/Explorer';
import { GitPanel } from './components/GitPanel';
import { StatusBar } from './components/StatusBar';
import { AboutDialog } from './components/AboutDialog';
import { AgentsBanner } from './components/AgentsBanner';
import { ClaudeIcon } from './components/ClaudeIcon';
import type { PaneId } from '../shared/types';

function RightColumn() {
  return (
    <PanelGroup direction="vertical" autoSaveId="ccs-right-layout">
      <Panel defaultSize={60} minSize={20}>
        <Explorer />
      </Panel>
      <PanelResizeHandle className="resize-handle-h" />
      <Panel defaultSize={40} minSize={15}>
        <GitPanel />
      </Panel>
    </PanelGroup>
  );
}

export default function App() {
  const loadProjects = useAppStore((s) => s.loadProjects);
  const loadAgents = useAppStore((s) => s.loadAgents);
  const checkAgents = useAppStore((s) => s.checkAgents);
  const subscribeGitChanges = useAppStore((s) => s.subscribeGitChanges);
  const loadLayout = useAppStore((s) => s.loadLayout);
  const layout = useAppStore((s) => s.layout);
  const updateLayoutSizes = useAppStore((s) => s.updateLayoutSizes);
  const loadTheme = useAppStore((s) => s.loadTheme);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const openTabs = useAppStore((s) => s.openTabs);
  const findProject = useAppStore((s) => s.findProject);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    loadProjects();
    loadAgents();
    checkAgents();
    loadLayout();
    loadTheme();
    loadSettings();
    const off = subscribeGitChanges();
    return off;
  }, [loadProjects, loadAgents, checkAgents, loadLayout, loadTheme, loadSettings, subscribeGitChanges]);

  useEffect(() => {
    const off = window.api.window.onFullscreenChange((on) => setFullscreen(on));
    return off;
  }, []);

  useEffect(() => {
    (window as unknown as { __getOpenTabs: () => string[] }).__getOpenTabs = () =>
      openTabs.map((id) => findProject(id)?.displayName ?? id);
  }, [openTabs, findProject]);

  const panes = useMemo(() => ({
    sidebar: {
      node: <Sidebar onAbout={() => setAboutOpen(true)} />,
      minSize: 14,
      maxSize: 40 as number | undefined,
    },
    middle: {
      node: <div className="middle"><TerminalTabs /></div>,
      minSize: 20,
      maxSize: undefined as number | undefined,
    },
    right: {
      node: <RightColumn />,
      minSize: 14,
      maxSize: 50 as number | undefined,
    },
  }), []);

  const order: [PaneId, PaneId, PaneId] = layout?.order ?? ['sidebar', 'middle', 'right'];
  const sizes: [number, number, number] = layout?.sizes ?? [20, 58, 22];
  const groupKey = order.join('-');

  return (
    <div className="app">
      {fullscreen && (
        <div className="app-header">
          <ClaudeIcon size={16} />
          <span>Parallel Agents</span>
        </div>
      )}
      <AgentsBanner />
      <div className="app-body">
        <PanelGroup
          key={groupKey}
          direction="horizontal"
          onLayout={(s) => updateLayoutSizes(s)}
        >
          {order.map((paneId, i) => {
            const pane = panes[paneId];
            return (
              <Fragment key={paneId}>
                <Panel
                  defaultSize={sizes[i]}
                  minSize={pane.minSize}
                  maxSize={pane.maxSize}
                >
                  {pane.node}
                </Panel>
                {i < order.length - 1 && (
                  <PanelResizeHandle className="resize-handle" />
                )}
              </Fragment>
            );
          })}
        </PanelGroup>
      </div>
      <StatusBar />
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  );
}
