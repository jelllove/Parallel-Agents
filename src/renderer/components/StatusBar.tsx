import { useRef, useState } from 'react';
import { useAppStore } from '../store/app-store';
import { LayoutPicker } from './LayoutPicker';
import { SettingsPicker } from './SettingsPicker';
import { FontSizePicker } from './FontSizePicker';
import { toggleFocus, togglePane } from '../../shared/pane-visibility';
import type { SidePaneId } from '../../shared/pane-visibility';
import type { LayoutConfig } from '../../shared/types';

export function StatusBar() {
  const layout = useAppStore((s) => s.layout);
  const setLayout = useAppStore((s) => s.setLayout);
  const layoutError = useAppStore((s) => s.layoutError);
  const [savingLayout, setSavingLayout] = useState(false);
  const hidden = layout?.hiddenPanes ?? [];
  const focused = hidden.includes('sidebar') && hidden.includes('right');
  async function changeVisibility(pane?: SidePaneId) {
    if (!layout || savingLayout) return;
    const next: LayoutConfig = pane ? togglePane(layout, pane) : toggleFocus(layout);
    setSavingLayout(true);
    try {
      await setLayout(next);
    } catch {
      /* The store reports the actual error in the status-bar alert. */
    } finally {
      setSavingLayout(false);
    }
  }
  const project = useAppStore((s) => {
    const focusedId = s.activeTabId
      ? (s.tabProjectId[s.activeTabId] ?? s.activeTabId)
      : s.selectedProjectId;
    if (!focusedId) return undefined;
    return (
      s.projects.find((p) => p.id === focusedId) ?? s.adhocProjects.find((p) => p.id === focusedId)
    );
  });
  const openTabs = useAppStore((s) => s.openTabs);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const layoutBtnRef = useRef<HTMLButtonElement | null>(null);
  const settingsBtnRef = useRef<HTMLButtonElement | null>(null);
  const [pickerRect, setPickerRect] = useState<DOMRect | null>(null);
  const [settingsRect, setSettingsRect] = useState<DOMRect | null>(null);

  return (
    <div className="status-bar">
      <button
        className="sb-btn"
        aria-label="Toggle project sidebar"
        aria-pressed={!hidden.includes('sidebar')}
        title={hidden.includes('sidebar') ? 'Show project sidebar' : 'Hide project sidebar'}
        disabled={!layout || savingLayout}
        onClick={() => void changeVisibility('sidebar')}
      >
        Projects
      </button>
      <button
        className="sb-btn"
        aria-label="Toggle files and Git sidebar"
        aria-pressed={!hidden.includes('right')}
        title={
          hidden.includes('right') ? 'Show files and Git sidebar' : 'Hide files and Git sidebar'
        }
        disabled={!layout || savingLayout}
        onClick={() => void changeVisibility('right')}
      >
        Files / Git
      </button>
      <button
        className="sb-btn"
        aria-label="Focus coding"
        aria-pressed={focused}
        title={focused ? 'Restore both sidebars' : 'Focus coding: hide both sidebars'}
        disabled={!layout || savingLayout}
        onClick={() => void changeVisibility()}
      >
        {focused ? 'Restore panels' : 'Focus coding'}
      </button>
      {layoutError && (
        <span className="layout-error" role="alert" title={layoutError}>
          {layoutError}
        </span>
      )}
      <span className="item">Mode: Ready</span>
      <span className="item">Tabs: {openTabs.length}</span>
      <span className="spacer" />
      {project && (
        <span className="item status-project-path" title={project.realPath}>
          {project.realPath}
        </span>
      )}
      <FontSizePicker />
      <button
        className="sb-btn"
        title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
        onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      >
        {theme === 'light' ? '☾' : '☀'}
      </button>
      <button
        ref={settingsBtnRef}
        className="sb-btn"
        title="Settings"
        onClick={() => {
          if (settingsRect) {
            setSettingsRect(null);
            return;
          }
          const r = settingsBtnRef.current?.getBoundingClientRect();
          if (r) setSettingsRect(r);
        }}
      >
        ⚙
      </button>
      <button
        ref={layoutBtnRef}
        className="sb-btn"
        title="Window layout"
        onClick={() => {
          if (pickerRect) {
            setPickerRect(null);
            return;
          }
          const r = layoutBtnRef.current?.getBoundingClientRect();
          if (r) setPickerRect(r);
        }}
      >
        ⊞
      </button>
      {pickerRect && <LayoutPicker anchorRect={pickerRect} onClose={() => setPickerRect(null)} />}
      {settingsRect && (
        <SettingsPicker anchorRect={settingsRect} onClose={() => setSettingsRect(null)} />
      )}
    </div>
  );
}
