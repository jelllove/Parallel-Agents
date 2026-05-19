import { create } from 'zustand';
import type { Project, Session } from '../../shared/types';

interface AppState {
  projects: Project[];
  adhocProjects: Project[];
  selectedProjectId: string | null;
  openTabs: string[];
  activeTabId: string | null;
  pendingInitialCommand: Record<string, string>;
  sessions: Record<string, Session[]>;
  showHidden: boolean;
  claudeStatus: 'unknown' | 'available' | 'missing';
  claudePath: string | null;

  loadProjects: () => Promise<void>;
  selectProject: (id: string) => Promise<void>;
  openTab: (id: string) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setShowHidden: (v: boolean) => void;
  pinProject: (id: string, pinned: boolean) => Promise<void>;
  hideProject: (id: string, hidden: boolean) => Promise<void>;
  loadSessions: (projectId: string) => Promise<void>;
  newSessionFromDialog: () => Promise<void>;
  consumePendingCommand: (projectId: string) => string | undefined;
  findProject: (id: string) => Project | undefined;
  checkClaude: () => Promise<void>;
  queueClaudeOnOpen: (projectId: string) => void;
}

function displayNameFor(realPath: string): string {
  const parts = realPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || realPath;
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  adhocProjects: [],
  selectedProjectId: null,
  openTabs: [],
  activeTabId: null,
  pendingInitialCommand: {},
  sessions: {},
  showHidden: false,
  claudeStatus: 'unknown',
  claudePath: null,

  async loadProjects() {
    const projects = await window.api.projects.list();
    set({ projects });
  },

  async selectProject(id) {
    set({ selectedProjectId: id });
    const p = get().findProject(id);
    if (p && !p.dirName.startsWith('adhoc:')) {
      await get().loadSessions(id);
    }
  },

  openTab(id) {
    const { openTabs } = get();
    if (!openTabs.includes(id)) {
      set({ openTabs: [...openTabs, id], activeTabId: id });
    } else {
      set({ activeTabId: id });
    }
  },

  closeTab(id) {
    const { openTabs, activeTabId, adhocProjects } = get();
    const next = openTabs.filter((t) => t !== id);
    let nextActive = activeTabId;
    if (activeTabId === id) {
      const idx = openTabs.indexOf(id);
      nextActive = next[idx] ?? next[idx - 1] ?? null;
    }
    window.api.pty.kill(id);
    set({
      openTabs: next,
      activeTabId: nextActive,
      adhocProjects: adhocProjects.filter((p) => p.id !== id),
    });
  },

  setActiveTab(id) {
    set({ activeTabId: id });
  },

  setShowHidden(v) {
    set({ showHidden: v });
  },

  async pinProject(id, pinned) {
    await window.api.projects.pin(id, pinned);
    await get().loadProjects();
  },

  async hideProject(id, hidden) {
    await window.api.projects.hide(id, hidden);
    await get().loadProjects();
  },

  async loadSessions(projectId) {
    const list = await window.api.sessions.listForProject(projectId);
    set({ sessions: { ...get().sessions, [projectId]: list } });
  },

  async newSessionFromDialog() {
    const dir = await window.api.dialog.pickDirectory();
    if (!dir) return;

    const existing = get().projects.find((p) => p.realPath.toLowerCase() === dir.toLowerCase());
    const id = existing ? existing.id : `adhoc:${dir}`;

    if (!existing && !get().adhocProjects.some((p) => p.id === id)) {
      const adhoc: Project = {
        id,
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

    set({
      pendingInitialCommand: { ...get().pendingInitialCommand, [id]: 'claude' },
    });
    get().openTab(id);
  },

  consumePendingCommand(projectId) {
    const cmd = get().pendingInitialCommand[projectId];
    if (cmd) {
      const next = { ...get().pendingInitialCommand };
      delete next[projectId];
      set({ pendingInitialCommand: next });
    }
    return cmd;
  },

  findProject(id) {
    return get().projects.find((p) => p.id === id) ?? get().adhocProjects.find((p) => p.id === id);
  },

  async checkClaude() {
    const r = await window.api.claude.check();
    set({ claudeStatus: r.available ? 'available' : 'missing', claudePath: r.path });
  },

  queueClaudeOnOpen(projectId) {
    set({
      pendingInitialCommand: { ...get().pendingInitialCommand, [projectId]: 'claude' },
    });
  },
}));
