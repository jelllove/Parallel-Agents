import { create } from 'zustand';
import { DEFAULT_AGENT_ORDER } from '../../shared/types.ts';
import type {
  Project,
  Session,
  AgentId,
  AgentInfo,
  AgentStatus,
  GitStatus,
  LayoutConfig,
  ThemeMode,
  NewProjectOptions,
} from '../../shared/types.ts';
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  validateFontFamily,
  validateFontSize,
  type FontFamilyId,
} from '../../shared/typography.ts';
import { startCommandFor, resumeCommandFor, extraPathFor } from '../../shared/agent-commands.ts';
import { orderedAgents } from '../../shared/sidebar-order.ts';
import { pickDeletableMissingProjectIds } from './project-cleanup.ts';
import { groupProjectTrees } from '../../shared/project-tree.ts';
import {
  cleanupShellStateForTabs,
  closeTabIds,
  omitRecordKeys,
  setTabShellVisibility as setTabShellVisibilityRecord,
  tabKeysForProject,
  terminalKeysForClosingTabs,
} from './tab-state.ts';
import {
  agentTerminalKey,
  makeSessionTabKey,
  shellTerminalKey,
  type SessionShellProfile,
} from '../../shared/session-terminals.ts';

interface PendingLaunch {
  command: string;
  extraPath: string[];
}

interface Clipboard {
  mode: 'copy' | 'cut';
  paths: string[];
}

export interface SessionLinkRequest {
  tabId: string;
  sessionId?: string;
  renameAfterLink: boolean;
}

interface AppState {
  layoutError: string | null;
  layoutSaving: boolean;
  launchSettingsAgent: AgentId | null;
  showAgentLaunchSettings: (agent: AgentId | null) => void;
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
  tabSessionBaseline: Record<string, string[]>;
  sessionLinkRequest: SessionLinkRequest | null;
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
  agentOrder: AgentId[];
  pinnedAgents: AgentId[];
  expandedProjects: string[];
  sidebarTreeLoaded: boolean;
  sidebarTreeLoading: boolean;
  sidebarTreeError: string | null;
  sidebarTreeSaveVersion: number;
  clipboard: Clipboard | null;
  gitStatusByPath: Record<string, GitStatus | null>;
  layout: LayoutConfig | null;
  theme: ThemeMode;
  confirmOnCloseTab: boolean;
  terminalMultilineEnter: boolean;
  terminalCopyPaste: boolean;
  fontSize: number;
  fontFamily: FontFamilyId;
  fontBold: boolean;

  loadProjects: () => Promise<void>;
  loadAgents: () => Promise<void>;
  checkAgents: () => Promise<void>;
  refreshProjectsAndAgents: () => Promise<void>;
  selectProject: (id: string) => Promise<void>;
  openProjectFromList: (id: string) => Promise<void>;
  requestSessionSelection: (projectId: string) => void;
  openTabWithAgent: (
    projectId: string,
    agentId: AgentId,
    startCommand: string,
    extraPath?: string[],
  ) => Promise<void>;
  openSessionTab: (projectId: string, session: Session, separate?: boolean) => Promise<void>;
  requestSessionLink: (request: SessionLinkRequest | null) => void;
  linkSession: (tabId: string, sessionId: string) => void;
  setActiveTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeTabs: (ids: string[]) => void;
  openShellForTab: (projectId: string, profile?: SessionShellProfile) => void;
  setTabShellVisible: (projectId: string, visible: boolean) => void;
  setShowHidden: (v: boolean) => Promise<void>;
  toggleAgentGroup: (id: AgentId) => Promise<void>;
  reorderAgentGroups: (from: AgentId, to: AgentId, placement: 'before' | 'after') => Promise<void>;
  pinAgent: (agent: AgentId) => Promise<void>;
  setProjectExpanded: (id: string, expanded: boolean) => Promise<void>;
  loadSidebarTree: () => Promise<void>;
  saveSidebarTree: () => Promise<void>;
  pinProject: (id: string, pinned: boolean) => Promise<void>;
  hideProject: (id: string, hidden: boolean) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  deleteMissingProjects: (ids: string[]) => Promise<void>;
  reorderProjects: (agent: AgentId, fromId: string, toId: string) => Promise<void>;
  loadSessions: (projectId: string) => Promise<void>;
  deleteSession: (projectId: string, sessionId: string) => Promise<void>;
  renameSession: (projectId: string, sessionId: string, title: string) => Promise<void>;
  createProject: (options: NewProjectOptions) => Promise<void>;
  setFontSize: (size: number) => Promise<void>;
  setFontFamily: (fontFamily: string) => Promise<void>;
  setFontBold: (bold: boolean) => Promise<void>;
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
  restartTabWithCommand: (
    projectId: string,
    agentId: AgentId,
    command: string,
    extraPath?: string[],
  ) => Promise<void>;
}

const emptyStatus = (): Record<AgentId, AgentStatus> => ({
  claude: { available: false, path: null },
  codex: { available: false, path: null },
  gemini: { available: false, path: null },
  aider: { available: false, path: null },
  copilot: { available: false, path: null },
});

let layoutWriteTimer: ReturnType<typeof setTimeout> | null = null;
let layoutSaveId = 0;
function scheduleLayoutWrite(layout: LayoutConfig) {
  if (layoutWriteTimer) clearTimeout(layoutWriteTimer);
  layoutWriteTimer = setTimeout(() => {
    void window.api.config.setLayout(layout).catch((error: unknown) => {
      useAppStore.setState({
        layoutError: `Could not save window layout: ${error instanceof Error ? error.message : String(error)}`,
      });
    });
    layoutWriteTimer = null;
  }, 300);
}

export const useAppStore = create<AppState>((set, get) => ({
  layoutError: null,
  layoutSaving: false,
  launchSettingsAgent: null,
  showAgentLaunchSettings: (agent) => set({ launchSettingsAgent: agent }),
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
  tabSessionBaseline: {},
  sessionLinkRequest: null,
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
  agentOrder: [...DEFAULT_AGENT_ORDER],
  pinnedAgents: [],
  expandedProjects: [],
  sidebarTreeLoaded: false,
  sidebarTreeLoading: false,
  sidebarTreeError: null,
  sidebarTreeSaveVersion: 0,
  clipboard: null,
  gitStatusByPath: {},
  layout: null,
  theme: 'dark',
  confirmOnCloseTab: true,
  terminalMultilineEnter: true,
  terminalCopyPaste: true,
  fontSize: DEFAULT_FONT_SIZE,
  fontFamily: DEFAULT_FONT_FAMILY,
  fontBold: false,

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
      await Promise.all([get().loadProjects(), get().loadAgents(), get().checkAgents()]);

      const selectedId = get().selectedProjectId;
      const projectIds = new Set([
        ...Object.values(get().tabProjectId),
        ...(selectedId ? [selectedId] : []),
      ]);
      for (const id of projectIds) {
        const project = get().findProject(id);
        if (project && !project.dirName.startsWith('adhoc:')) await get().loadSessions(id);
      }
      const p = selectedId ? get().findProject(selectedId) : undefined;
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
      await get().openSessionTab(id, loadedSessions[0]);
      return;
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
    const tabId = projectId;
    if (get().openTabs.includes(tabId)) {
      set({ activeTabId: tabId });
      return;
    }
    const baseline = await window.api.sessions.listForProject(projectId);
    await window.api.config.setLastAgent(projectId, agentId);
    const { openTabs } = get();
    if (openTabs.includes(tabId)) {
      set({ activeTabId: tabId });
      return;
    }
    const pending: PendingLaunch = { command: startCommand, extraPath };
    const nextTabShellProfile = get().tabShellProfile[tabId]
      ? get().tabShellProfile
      : { ...get().tabShellProfile, [tabId]: 'default' as SessionShellProfile };
    const next: Partial<AppState> = {
      tabProjectId: { ...get().tabProjectId, [tabId]: projectId },
      tabSessionId: { ...get().tabSessionId, [tabId]: null },
      tabSessionBaseline:
        agentId === 'aider'
          ? get().tabSessionBaseline
          : { ...get().tabSessionBaseline, [tabId]: baseline.map((s) => s.id) },
      tabAgent: { ...get().tabAgent, [tabId]: agentId },
      activeTabId: tabId,
      tabShellProfile: nextTabShellProfile,
      pendingInitialCommand: { ...get().pendingInitialCommand, [tabId]: pending },
    };
    if (!openTabs.includes(tabId)) {
      next.openTabs = [...openTabs, tabId];
    }
    set(next);
  },

  async openSessionTab(projectId, session, separate = false) {
    const command = resumeCommandFor(session.agent, session.id);
    if (!command) return;

    const tabId = makeSessionTabKey(projectId, session.id);
    const existingTab = get().openTabs.find(
      (id) => get().tabAgent[id] === session.agent && get().tabSessionId[id] === session.id,
    );
    if (existingTab) {
      set({ activeTabId: existingTab });
      return;
    }
    const unboundTab = get().openTabs.find(
      (id) =>
        get().tabProjectId[id] === projectId &&
        get().tabAgent[id] === session.agent &&
        !get().tabSessionId[id] &&
        get().tabSessionBaseline[id] &&
        !get().tabSessionBaseline[id].includes(session.id),
    );
    if (unboundTab && !separate) {
      set({
        sessionLinkRequest: { tabId: unboundTab, sessionId: session.id, renameAfterLink: false },
      });
      return;
    }
    if (get().openTabs.includes(tabId)) {
      set({ activeTabId: tabId });
      return;
    }

    await window.api.config.setLastAgent(projectId, session.agent);
    const { openTabs, tabShellProfile } = get();
    const openedWhileWaiting = openTabs.find(
      (id) => get().tabAgent[id] === session.agent && get().tabSessionId[id] === session.id,
    );
    if (openedWhileWaiting) {
      set({ activeTabId: openedWhileWaiting });
      return;
    }
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

  requestSessionLink(request) {
    set({ sessionLinkRequest: request });
  },

  linkSession(tabId, sessionId) {
    const projectId = get().tabProjectId[tabId];
    const session = get().sessions[projectId]?.find((item) => item.id === sessionId);
    if (!get().openTabs.includes(tabId) || !session || session.agent !== get().tabAgent[tabId]) {
      throw new Error('The selected session is no longer available for this tab.');
    }
    const duplicate = get().openTabs.some(
      (id) =>
        id !== tabId &&
        get().tabAgent[id] === session.agent &&
        get().tabSessionId[id] === sessionId,
    );
    if (duplicate) throw new Error('This session is already linked to another tab.');
    set({
      tabSessionId: { ...get().tabSessionId, [tabId]: sessionId },
      tabSessionBaseline: omitRecordKeys(get().tabSessionBaseline, [tabId]),
      activeTabId: tabId,
      sessionLinkRequest: null,
    });
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
      tabSessionBaseline: omitRecordKeys(get().tabSessionBaseline, uniqueIds),
      sessionLinkRequest: uniqueIds.includes(get().sessionLinkRequest?.tabId ?? '')
        ? null
        : get().sessionLinkRequest,
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
      tabShellVisible: setTabShellVisibilityRecord(openTabs, tabShellVisible, projectId, true),
    });
  },

  setTabShellVisible(projectId, visible) {
    const { openTabs, tabShellVisible } = get();
    set({
      tabShellVisible: setTabShellVisibilityRecord(openTabs, tabShellVisible, projectId, visible),
    });
  },

  setActiveTab(id) {
    set({ activeTabId: id });
  },

  async setShowHidden(v) {
    if (!get().sidebarTreeLoaded) return get().saveSidebarTree();
    set({ showHidden: v });
    await get().saveSidebarTree();
  },

  async toggleAgentGroup(id) {
    if (!get().sidebarTreeLoaded) return get().saveSidebarTree();
    const cur = get().collapsedAgents;
    set({ collapsedAgents: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
    await get().saveSidebarTree();
  },

  async reorderAgentGroups(from, to, placement) {
    if (!get().sidebarTreeLoaded) return get().saveSidebarTree();
    if (from === to) return;
    const pinned = get().pinnedAgents;
    if (pinned.includes(from) !== pinned.includes(to)) {
      throw new Error('Reorder agents within the same pinned section.');
    }
    const current = orderedAgents(get());
    if (!current.includes(from) || !current.includes(to)) {
      set({
        sidebarTreeError: 'Cannot reorder unknown Agent sections. Reload the sidebar and retry.',
      });
      return;
    }
    const next = current.filter((id) => id !== from);
    next.splice(next.indexOf(to) + (placement === 'after' ? 1 : 0), 0, from);
    if (next.every((id, index) => id === current[index])) return;
    set({ agentOrder: next });
    await get().saveSidebarTree();
  },

  async pinAgent(agent) {
    if (!get().sidebarTreeLoaded) return get().saveSidebarTree();
    await window.api.config.setAgentPinned(agent, !get().pinnedAgents.includes(agent));
    const layout = await window.api.config.getAgentLayout();
    set(layout);
  },

  async setProjectExpanded(id, expanded) {
    if (!get().sidebarTreeLoaded) return get().saveSidebarTree();
    const cur = get().expandedProjects;
    if (cur.includes(id) === expanded) return;
    set({ expandedProjects: expanded ? [...cur, id] : cur.filter((x) => x !== id) });
    await get().saveSidebarTree();
  },

  async loadSidebarTree() {
    if (get().sidebarTreeLoaded || get().sidebarTreeLoading) return;
    set({ sidebarTreeLoading: true, sidebarTreeError: null });
    try {
      const [tree, layout] = await Promise.all([
        window.api.config.getSidebarTree(),
        window.api.config.getAgentLayout(),
      ]);
      set({ ...tree, ...layout, sidebarTreeLoaded: true, sidebarTreeError: null });
    } catch (error) {
      set({
        sidebarTreeError: `Cannot load sidebar layout: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      set({ sidebarTreeLoading: false });
    }
  },

  async saveSidebarTree() {
    if (!get().sidebarTreeLoaded) {
      set({
        sidebarTreeError: 'Sidebar layout is not loaded. Retry loading before making changes.',
      });
      return;
    }
    const { agentOrder, collapsedAgents, expandedProjects, showHidden } = get();
    const version = get().sidebarTreeSaveVersion + 1;
    set({ sidebarTreeSaveVersion: version, sidebarTreeError: null });
    try {
      await window.api.config.setSidebarTree({
        agentOrder,
        collapsedAgents,
        expandedProjects,
        showHidden,
      });
    } catch (error) {
      if (get().sidebarTreeSaveVersion === version) {
        set({
          sidebarTreeError: `Cannot save sidebar layout: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
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
      const relatedTabs = [
        ...new Set(
          targetIds.flatMap((projectId) => tabKeysForProject(get().tabProjectId, projectId)),
        ),
      ];
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
    const groups = groupProjectTrees(
      get().projects.filter((p) => p.agent === agent),
      true,
    );
    const fromIdx = groups.findIndex((group) => group.projects.some((p) => p.id === fromId));
    const toIdx = groups.findIndex((group) => group.projects.some((p) => p.id === toId));
    if (fromIdx < 0 || toIdx < 0) {
      throw new Error('Reorder projects within the same agent and the same pinned section.');
    }
    if (groups[fromIdx].pinned !== groups[toIdx].pinned) {
      throw new Error('Reorder projects within the same agent and the same pinned section.');
    }
    const [moved] = groups.splice(fromIdx, 1);
    groups.splice(toIdx, 0, moved);
    await window.api.projects.setOrder(
      agent,
      groups.flatMap((group) => group.projects.map((p) => p.id)),
    );
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

  async renameSession(projectId, sessionId, title) {
    const name = await window.api.sessions.rename(projectId, sessionId, title);
    const agent = get().sessions[projectId]?.find((s) => s.id === sessionId)?.agent;
    set((state) => ({
      sessions: Object.fromEntries(
        Object.entries(state.sessions).map(([id, sessions]) => [
          id,
          sessions.map((s) =>
            s.id === sessionId && (s.agent === agent || id === projectId)
              ? { ...s, title: name }
              : s,
          ),
        ]),
      ),
    }));
  },

  async createProject(options) {
    const project = await window.api.projects.create(options);
    set({
      projects: [...get().projects.filter((p) => p.id !== project.id), project],
      selectedProjectId: project.id,
    });
    await get().openTabWithAgent(
      project.id,
      options.agent,
      startCommandFor(options.agent),
      extraPathFor(get().agentStatus[options.agent]?.path),
    );
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
    try {
      const layout = await window.api.config.getLayout();
      set({ layout, layoutError: null });
    } catch (error) {
      set({
        layoutError: `Could not load window layout: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },

  async setLayout(layout) {
    const saveId = ++layoutSaveId;
    const previous = get().layout;
    set({ layout, layoutError: null, layoutSaving: true });
    if (layoutWriteTimer) {
      clearTimeout(layoutWriteTimer);
      layoutWriteTimer = null;
    }
    try {
      await window.api.config.setLayout(layout);
    } catch (error) {
      if (get().layout === layout) set({ layout: previous });
      set({
        layoutError: `Could not save window layout: ${error instanceof Error ? error.message : String(error)}`,
      });
      throw error;
    } finally {
      if (saveId === layoutSaveId) set({ layoutSaving: false });
    }
  },

  updateLayoutSizes(sizes) {
    const cur = get().layout;
    if (get().layoutSaving) return;
    if (!cur) return;
    if (cur.hiddenPanes?.length) return;
    if (sizes.length !== 3) return;
    const next: LayoutConfig = {
      ...cur,
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
    const [
      confirmOnCloseTab,
      terminalMultilineEnter,
      terminalCopyPaste,
      fontSize,
      fontFamily,
      fontBold,
    ] = await Promise.all([
      window.api.config.getConfirmOnCloseTab(),
      window.api.config.getTerminalMultilineEnter(),
      window.api.config.getTerminalCopyPaste(),
      window.api.config.getFontSize(),
      window.api.config.getFontFamily(),
      window.api.config.getFontBold(),
    ]);
    const validatedFontFamily = validateFontFamily(fontFamily);
    document.documentElement.style.setProperty('--app-font-size', `${fontSize}px`);
    document.documentElement.style.setProperty('--app-font-weight', fontBold ? '700' : '400');
    set({
      confirmOnCloseTab,
      terminalMultilineEnter,
      terminalCopyPaste,
      fontSize,
      fontFamily: validatedFontFamily,
      fontBold,
    });
  },

  async setFontSize(size) {
    validateFontSize(size);
    await window.api.config.setFontSize(size);
    document.documentElement.style.setProperty('--app-font-size', `${size}px`);
    set({ fontSize: size });
  },

  async setFontFamily(fontFamily) {
    const next = validateFontFamily(fontFamily);
    await window.api.config.setFontFamily(next);
    set({ fontFamily: next });
  },

  async setFontBold(bold) {
    if (typeof bold !== 'boolean') throw new Error('Font bold must be a boolean.');
    await window.api.config.setFontBold(bold);
    document.documentElement.style.setProperty('--app-font-weight', bold ? '700' : '400');
    set({ fontBold: bold });
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
        tabRespawnNonce: {
          ...get().tabRespawnNonce,
          [projectId]: (get().tabRespawnNonce[projectId] ?? 0) + 1,
        },
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
