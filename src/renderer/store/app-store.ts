import { create } from 'zustand';
import type { Project, Session, AgentId, AgentInfo, AgentStatus, GitStatus, LayoutConfig, ThemeMode } from '../../shared/types';
import { startCommandFor, resumeCommandFor, extraPathFor } from '../icons/agentIcons';
import { pickDeletableMissingProjectIds } from './project-cleanup';
import {
  cleanupShellStateForTabs,
  closeTabIds,
  omitRecordKeys,
  setTabShellVisibility as setTabShellVisibilityRecord,
  tabKeysForProject,
  terminalKeysForClosingTabs,
} from './tab-state';
import {
  agentTerminalKey,
  makeSessionTabKey,
  shellTerminalKey,
  type SessionShellProfile,
} from '../../shared/session-terminals';

interface PendingLaunch {
  command: string;
  extraPath: string[];
}

interface Clipboard {
  mode: 'copy' | 'cut';
  paths: string[];
}

interface AppState {
  projects: Project[];
  adhocProjects: Project[];
  inventoryRefreshing: boolean;
  inventoryError: string | null;
  selectedProjectId: string | null;
  sessionGuideProjectId: string | null;
  sessionGuideSeq: number;
  openTabs: string[];
  activeTabId: string | null;
  tabProjectId: Record<string, string>;
  tabSessionId: Record<string, string | null>;
  pendingInitialCommand: Record<string, PendingLaunch>;
  tabAgent: Record<string, AgentId>;
  tabRespawnNonce: Record<string, number>;
  tabShellProfile: Record<string, SessionShellProfile>;
  tabShellOpened: Record<string, boolean>;
  tabShellVisible: Record<string, boolean>;
  sessions: Record<string, Session[]>;
  showHidden: boolean;
  agents: AgentInfo[];
  agentStatus: Record<AgentId, AgentStatus>;
  collapsedAgents: AgentId[];
  clipboard: Clipboard | null;
  gitStatusByPath: Record<string, GitStatus | null>;
  layout: LayoutConfig | null;
  theme: ThemeMode;
  confirmOnCloseTab: boolean;
  terminalMultilineEnter: boolean;
  terminalCopyPaste: boolean;

  loadProjects: () => Promise<void>;
  loadAgents: () => Promise<void>;
  checkAgents: () => Promise<void>;
  refreshProjectsAndAgents: () => Promise<void>;
  selectProject: (id: string) => Promise<void>;
  openProjectFromList: (id: string) => Promise<void>;
  requestSessionSelection: (projectId: string) => void;
  openTabWithAgent: (projectId: string, agentId: AgentId, startCommand: string, extraPath?: string[]) => Promise<void>;
  openSessionTab: (projectId: string, session: Session) => Promise<void>;
  setActiveTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeTabs: (ids: string[]) => void;
  openShellForTab: (projectId: string, profile?: SessionShellProfile) => void;
  setTabShellVisible: (projectId: string, visible: boolean) => void;
  setShowHidden: (v: boolean) => void;
  toggleAgentGroup: (id: AgentId) => void;
  pinProject: (id: string, pinned: boolean) => Promise<void>;
  hideProject: (id: string, hidden: boolean) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  deleteMissingProjects: (ids: string[]) => Promise<void>;
  reorderProjects: (agent: AgentId, fromId: string, toId: string) => Promise<void>;
  loadSessions: (projectId: string) => Promise<void>;
  deleteSession: (projectId: string, sessionId: string) => Promise<void>;
  newSessionFromDialog: (agentId: AgentId, startCommand: string, extraPath?: string[]) => Promise<void>;
  consumePendingCommand: (projectId: string) => PendingLaunch | undefined;
  findProject: (id: string) => Project | undefined;
  getProjectAgent: (projectId: string) => Promise<AgentId>;
  setClipboard: (clip: Clipboard | null) => void;
  loadGitStatus: (repoPath: string) => Promise<void>;
  subscribeGitChanges: () => () => void;
  loadLayout: () => Promise<void>;
  setLayout: (layout: LayoutConfig) => Promise<void>;
  updateLayoutSizes: (sizes: number[]) => void;
  loadTheme: () => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  loadSettings: () => Promise<void>;
  setConfirmOnCloseTab: (v: boolean) => Promise<void>;
  setTerminalMultilineEnter: (v: boolean) => Promise<void>;
  setTerminalCopyPaste: (v: boolean) => Promise<void>;
  reorderTabs: (fromId: string, toId: string) => void;
  restartTabWithCommand: (projectId: string, agentId: AgentId, command: string, extraPath?: string[]) => Promise<void>;
}

function displayNameFor(realPath: string): string {
  const parts = realPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || realPath;
}

const emptyStatus = (): Record<AgentId, AgentStatus> => ({
  claude: { available: false, path: null },
  codex: { available: false, path: null },
  gemini: { available: false, path: null },
  aider: { available: false, path: null },
  copilot: { available: false, path: null },
});

let layoutWriteTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleLayoutWrite(layout: LayoutConfig) {
  if (layoutWriteTimer) clearTimeout(layoutWriteTimer);
  layoutWriteTimer = setTimeout(() => {
    void window.api.config.setLayout(layout);
    layoutWriteTimer = null;
  }, 300);
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  adhocProjects: [],
  inventoryRefreshing: false,
  inventoryError: null,
  selectedProjectId: null,
  sessionGuideProjectId: null,
  sessionGuideSeq: 0,
  openTabs: [],
  activeTabId: null,
  tabProjectId: {},
  tabSessionId: {},
  pendingInitialCommand: {},
  tabAgent: {},
  tabRespawnNonce: {},
  tabShellProfile: {},
  tabShellOpened: {},
  tabShellVisible: {},
  sessions: {},
  showHidden: false,
  agents: [],
  agentStatus: emptyStatus(),
  collapsedAgents: [],
  clipboard: null,
  gitStatusByPath: {},
  layout: null,
  theme: 'dark',
  confirmOnCloseTab: true,
  terminalMultilineEnter: true,
  terminalCopyPaste: true,

  async loadProjects() {
    const projects = await window.api.projects.list();
    set({ projects });
  },

  async loadAgents() {
    const agents = await window.api.agents.list();
    set({ agents });
  },

  async checkAgents() {
    const status = await window.api.agents.checkAll();
    set({ agentStatus: status });
  },

  async refreshProjectsAndAgents() {
    if (get().inventoryRefreshing) return;
    set({ inventoryRefreshing: true, inventoryError: null });
    try {
      await Promise.all([
        get().loadProjects(),
        get().loadAgents(),
        get().checkAgents(),
      ]);

      const selectedId = get().selectedProjectId;
      if (!selectedId) return;

      const p = get().findProject(selectedId);
      if (p && !p.dirName.startsWith('adhoc:')) {
        await get().loadSessions(selectedId);
      }
      if (p?.exists) {
        await get().loadGitStatus(p.realPath);
      }
    } catch (error) {
      set({ inventoryError: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ inventoryRefreshing: false });
    }
  },

  async selectProject(id) {
    set({ selectedProjectId: id });
    const p = get().findProject(id);
    if (p && !p.dirName.startsWith('adhoc:')) {
      await get().loadSessions(id);
    }
    if (p?.exists) {
      void get().loadGitStatus(p.realPath);
      void window.api.git.watch(p.realPath);
    }
  },

  requestSessionSelection(projectId) {
    set((state) => ({
      sessionGuideProjectId: projectId,
      sessionGuideSeq: state.sessionGuideSeq + 1,
    }));
  },

  async openProjectFromList(id) {
    await get().selectProject(id);
    const p = get().findProject(id);
    if (!p || !p.exists) return;

    const loadedSessions = get().sessions[id] ?? [];
    const hasMultipleSessions = p.sessionCount > 1 || loadedSessions.length > 1;
    if (hasMultipleSessions) {
      get().requestSessionSelection(id);
      return;
    }

    if (loadedSessions.length === 1) {
      const only = loadedSessions[0];
      const cmd = resumeCommandFor(only.agent, only.id);
      if (cmd) {
        await get().restartTabWithCommand(
          id,
          only.agent,
          cmd,
          extraPathFor(get().agentStatus[only.agent]?.path),
        );
        return;
      }
    }

    if (get().openTabs.includes(id)) {
      get().setActiveTab(id);
      return;
    }

    await get().openTabWithAgent(
      id,
      p.agent,
      startCommandFor(p.agent),
      extraPathFor(get().agentStatus[p.agent]?.path),
    );
  },

  async openTabWithAgent(projectId, agentId, startCommand, extraPath = []) {
    const { openTabs } = get();
    const tabId = projectId;
    await window.api.config.setLastAgent(projectId, agentId);
    const pending: PendingLaunch = { command: startCommand, extraPath };
    const nextTabShellProfile = get().tabShellProfile[tabId]
      ? get().tabShellProfile
      : { ...get().tabShellProfile, [tabId]: 'default' as SessionShellProfile };
    const next: Partial<AppState> = {
      tabProjectId: { ...get().tabProjectId, [tabId]: projectId },
      tabSessionId: { ...get().tabSessionId, [tabId]: null },
      tabAgent: { ...get().tabAgent, [tabId]: agentId },
      activeTabId: tabId,
      tabShellProfile: nextTabShellProfile,
      pendingInitialCommand: { ...get().pendingInitialCommand, [tabId]: pending },
    };
    if (!openTabs.includes(tabId)) {
      next.openTabs = [...openTabs, tabId];
    }
    set(next as AppState);
  },

  async openSessionTab(projectId, session) {
    const command = resumeCommandFor(session.agent, session.id);
    if (!command) return;

    const tabId = makeSessionTabKey(projectId, session.id);
    const { openTabs, tabShellProfile } = get();
    if (openTabs.includes(tabId)) {
      set({ activeTabId: tabId });
      return;
    }

    await window.api.config.setLastAgent(projectId, session.agent);
    const pending: PendingLaunch = {
      command,
      extraPath: extraPathFor(get().agentStatus[session.agent]?.path),
    };
    const nextTabShellProfile = tabShellProfile[tabId]
      ? tabShellProfile
      : { ...tabShellProfile, [tabId]: 'default' as SessionShellProfile };

    set({
      openTabs: [...openTabs, tabId],
      activeTabId: tabId,
      tabProjectId: { ...get().tabProjectId, [tabId]: projectId },
      tabSessionId: { ...get().tabSessionId, [tabId]: session.id },
      tabAgent: { ...get().tabAgent, [tabId]: session.agent },
      tabShellProfile: nextTabShellProfile,
      pendingInitialCommand: { ...get().pendingInitialCommand, [tabId]: pending },
    });
  },

  closeTab(id) {
    get().closeTabs([id]);
  },

  closeTabs(ids) {
    const uniqueIds = [...new Set(ids)];
    const {
      openTabs,
      activeTabId,
      tabProjectId,
      tabSessionId,
      adhocProjects,
      tabAgent,
      pendingInitialCommand,
      tabRespawnNonce,
      tabShellProfile,
      tabShellOpened,
      tabShellVisible,
    } = get();
    const nextTabs = closeTabIds(openTabs, activeTabId, uniqueIds);
    const terminalKeys = terminalKeysForClosingTabs(
      uniqueIds.filter((id) => openTabs.includes(id)),
      tabShellOpened,
      tabShellProfile,
    );
    for (const terminalKey of terminalKeys) {
      void window.api.pty.kill(terminalKey);
    }
    set({
      ...nextTabs,
      tabProjectId: omitRecordKeys(tabProjectId, uniqueIds),
      tabSessionId: omitRecordKeys(tabSessionId, uniqueIds),
      adhocProjects: adhocProjects.filter((p) => !uniqueIds.includes(p.id)),
      tabAgent: omitRecordKeys(tabAgent, uniqueIds),
      pendingInitialCommand: omitRecordKeys(pendingInitialCommand, uniqueIds),
      tabRespawnNonce: omitRecordKeys(tabRespawnNonce, uniqueIds),
      tabShellProfile: cleanupShellStateForTabs(tabShellProfile, uniqueIds),
      tabShellOpened: cleanupShellStateForTabs(tabShellOpened, uniqueIds),
      tabShellVisible: cleanupShellStateForTabs(tabShellVisible, uniqueIds),
    });
  },

  openShellForTab(projectId, profile) {
    const { openTabs, tabShellOpened, tabShellProfile, tabShellVisible } = get();
    if (!openTabs.includes(projectId)) return;
    const currentProfile = tabShellProfile[projectId] ?? 'default';
    const nextProfile = profile ?? currentProfile;
    if (tabShellOpened[projectId] && currentProfile !== nextProfile) {
      void window.api.pty.kill(shellTerminalKey(projectId, currentProfile));
    }
    set({
      activeTabId: projectId,
      tabShellProfile: { ...tabShellProfile, [projectId]: nextProfile },
      tabShellOpened: { ...tabShellOpened, [projectId]: true },
      tabShellVisible: setTabShellVisibilityRecord(
        openTabs,
        tabShellVisible,
        projectId,
        true,
      ),
    });
  },

  setTabShellVisible(projectId, visible) {
    const { openTabs, tabShellVisible } = get();
    set({
      tabShellVisible: setTabShellVisibilityRecord(
        openTabs,
        tabShellVisible,
        projectId,
        visible,
      ),
    });
  },

  setActiveTab(id) {
    set({ activeTabId: id });
  },

  setShowHidden(v) {
    set({ showHidden: v });
  },

  toggleAgentGroup(id) {
    const cur = get().collapsedAgents;
    set({ collapsedAgents: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  },

  async pinProject(id, pinned) {
    await window.api.projects.pin(id, pinned);
    await get().loadProjects();
  },

  async hideProject(id, hidden) {
    await window.api.projects.hide(id, hidden);
    await get().loadProjects();
  },

  async deleteProject(id) {
    await window.api.projects.delete(id);
    const relatedTabs = tabKeysForProject(get().tabProjectId, id);
    if (relatedTabs.length > 0) get().closeTabs(relatedTabs);
    const { sessions } = get();
    const nextSessions = { ...sessions };
    delete nextSessions[id];
    set({
      sessions: nextSessions,
      selectedProjectId: get().selectedProjectId === id ? null : get().selectedProjectId,
    });
    await get().loadProjects();
  },

  async deleteMissingProjects(ids) {
    if (ids.length === 0) {
      set({ inventoryError: 'No projects selected' });
      throw new Error('No projects selected');
    }
    try {
      await get().loadProjects();
      const targetIds = pickDeletableMissingProjectIds(get().projects, ids);
      if (targetIds.length === 0) {
        const error = new Error('No deleted projects are currently available to delete');
        set({ inventoryError: error.message });
        throw error;
      }

      await window.api.projects.deleteMissing(targetIds);
      const relatedTabs = [...new Set(
        targetIds.flatMap((projectId) => tabKeysForProject(get().tabProjectId, projectId)),
      )];
      if (relatedTabs.length > 0) get().closeTabs(relatedTabs);
      const nextSessions = { ...get().sessions };
      for (const id of targetIds) delete nextSessions[id];
      set({
        sessions: nextSessions,
        selectedProjectId: targetIds.includes(get().selectedProjectId ?? '')
          ? null
          : get().selectedProjectId,
        inventoryError: null,
      });
    } catch (error) {
      set({ inventoryError: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      try {
        await get().loadProjects();
      } catch (error) {
        set({ inventoryError: error instanceof Error ? error.message : String(error) });
      }
    }
  },

  async reorderProjects(agent, fromId, toId) {
    if (fromId === toId) return;
    const groupIds = get().projects.filter((p) => p.agent === agent).map((p) => p.id);
    const fromIdx = groupIds.indexOf(fromId);
    const toIdx = groupIds.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...groupIds];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, fromId);
    await window.api.projects.setOrder(agent, next);
    await get().loadProjects();
  },

  async loadSessions(projectId) {
    const list = await window.api.sessions.listForProject(projectId);
    set({ sessions: { ...get().sessions, [projectId]: list } });
  },

  async deleteSession(projectId, sessionId) {
    await window.api.sessions.delete(projectId, sessionId);
    await get().loadSessions(projectId);
  },

  async newSessionFromDialog(agentId, startCommand, extraPath = []) {
    const dir = await window.api.dialog.pickDirectory();
    if (!dir) return;

    const existing = get().projects.find((p) => p.realPath.toLowerCase() === dir.toLowerCase());
    const id = existing ? existing.id : `adhoc:${dir}`;

    if (!existing && !get().adhocProjects.some((p) => p.id === id)) {
      const adhoc: Project = {
        id,
        agent: agentId,
        dirName: id,
        realPath: dir,
        displayName: displayNameFor(dir),
        exists: true,
        pinned: false,
        hidden: false,
        sessionCount: 0,
        lastActivity: null,
      };
      set({ adhocProjects: [...get().adhocProjects, adhoc] });
    }

    await get().openTabWithAgent(id, agentId, startCommand, extraPath);
  },

  consumePendingCommand(projectId) {
    const pending = get().pendingInitialCommand[projectId];
    if (pending) {
      const next = { ...get().pendingInitialCommand };
      delete next[projectId];
      set({ pendingInitialCommand: next });
    }
    return pending;
  },

  findProject(id) {
    return get().projects.find((p) => p.id === id) ?? get().adhocProjects.find((p) => p.id === id);
  },

  async getProjectAgent(projectId) {
    const remembered = await window.api.config.getLastAgent(projectId);
    if (remembered) return remembered;
    const p = get().findProject(projectId);
    return p?.agent ?? 'claude';
  },

  setClipboard(clip) {
    set({ clipboard: clip });
  },

  async loadGitStatus(repoPath) {
    const status = await window.api.git.status(repoPath);
    set({ gitStatusByPath: { ...get().gitStatusByPath, [repoPath]: status } });
  },

  subscribeGitChanges() {
    return window.api.git.onChanged((repoPath) => {
      void get().loadGitStatus(repoPath);
    });
  },

  async loadLayout() {
    const layout = await window.api.config.getLayout();
    set({ layout });
  },

  async setLayout(layout) {
    set({ layout });
    if (layoutWriteTimer) { clearTimeout(layoutWriteTimer); layoutWriteTimer = null; }
    await window.api.config.setLayout(layout);
  },

  updateLayoutSizes(sizes) {
    const cur = get().layout;
    if (!cur) return;
    if (sizes.length !== 3) return;
    const next: LayoutConfig = {
      order: cur.order,
      sizes: [sizes[0], sizes[1], sizes[2]],
    };
    const same = cur.sizes.every((v, i) => Math.abs(v - next.sizes[i]) < 0.01);
    if (same) return;
    set({ layout: next });
    scheduleLayoutWrite(next);
  },

  async loadTheme() {
    const theme = await window.api.config.getTheme();
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },

  async setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
    await window.api.config.setTheme(theme);
  },

  async loadSettings() {
    const [confirmOnCloseTab, terminalMultilineEnter, terminalCopyPaste] = await Promise.all([
      window.api.config.getConfirmOnCloseTab(),
      window.api.config.getTerminalMultilineEnter(),
      window.api.config.getTerminalCopyPaste(),
    ]);
    set({ confirmOnCloseTab, terminalMultilineEnter, terminalCopyPaste });
  },

  async setConfirmOnCloseTab(v) {
    set({ confirmOnCloseTab: v });
    await window.api.config.setConfirmOnCloseTab(v);
  },

  async setTerminalMultilineEnter(v) {
    set({ terminalMultilineEnter: v });
    await window.api.config.setTerminalMultilineEnter(v);
  },

  async setTerminalCopyPaste(v) {
    set({ terminalCopyPaste: v });
    await window.api.config.setTerminalCopyPaste(v);
  },

  reorderTabs(fromId, toId) {
    if (fromId === toId) return;
    const { openTabs } = get();
    const fromIdx = openTabs.indexOf(fromId);
    const toIdx = openTabs.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...openTabs];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, fromId);
    set({ openTabs: next });
  },

  async restartTabWithCommand(projectId, agentId, command, extraPath = []) {
    const { openTabs } = get();
    await window.api.config.setLastAgent(projectId, agentId);
    const pending: PendingLaunch = { command, extraPath };
    if (openTabs.includes(projectId)) {
      // Tab already open: kill the running CLI and re-spawn via TerminalPane's
      // remount. The TerminalPane is keyed on projectId, so to force a remount
      // we toggle a tabRespawnNonce.
      await window.api.pty.kill(agentTerminalKey(projectId));
      set({
        tabProjectId: { ...get().tabProjectId, [projectId]: projectId },
        tabSessionId: { ...get().tabSessionId, [projectId]: null },
        tabAgent: { ...get().tabAgent, [projectId]: agentId },
        activeTabId: projectId,
        pendingInitialCommand: { ...get().pendingInitialCommand, [projectId]: pending },
        tabRespawnNonce: { ...get().tabRespawnNonce, [projectId]: (get().tabRespawnNonce[projectId] ?? 0) + 1 },
      });
    } else {
      set({
        tabProjectId: { ...get().tabProjectId, [projectId]: projectId },
        tabSessionId: { ...get().tabSessionId, [projectId]: null },
        tabAgent: { ...get().tabAgent, [projectId]: agentId },
        activeTabId: projectId,
        pendingInitialCommand: { ...get().pendingInitialCommand, [projectId]: pending },
        openTabs: [...openTabs, projectId],
      });
    }
  },
}));
