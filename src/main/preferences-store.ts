import { mkdir, readFile, rename, writeFile, unlink } from 'fs/promises';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { validateSessionName } from '../shared/session-presentation.ts';
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  validateFontFamily,
  validateFontSize,
  type FontFamilyId,
} from '../shared/typography.ts';
import type {
  AgentId,
  RegisteredProject,
  SavedOpenTabs,
  SavedTab,
  SortOrders,
  SortPanel,
} from '../shared/types.ts';
import { parseSortKey, type SortKey } from '../shared/sorting.ts';
import { renameWithRetry, type RenameFile } from './atomic-rename.ts';

interface Preferences {
  sessionNames: Record<string, string>;
  fontSize: number;
  fontFamily: FontFamilyId;
  fontBold: boolean;
  projects: RegisteredProject[];
  recentFolders: string[];
  openTabs: SavedOpenTabs;
  sortOrders: SortOrders;
}

const DEFAULT_SORT_ORDERS: SortOrders = {
  projects: 'created',
  sessions: 'created',
  explorer: 'created',
};

function validateSortOrders(value: unknown): SortOrders {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid sort orders.');
  }
  const raw = value as Record<string, unknown>;
  return {
    projects: parseSortKey(raw.projects, DEFAULT_SORT_ORDERS.projects),
    sessions: parseSortKey(raw.sessions, DEFAULT_SORT_ORDERS.sessions),
    explorer: parseSortKey(raw.explorer, DEFAULT_SORT_ORDERS.explorer),
  };
}

export const MAX_RECENT_FOLDERS = 18;

const agentIds = new Set<AgentId>(['claude', 'codex', 'gemini', 'aider', 'copilot']);

function validateRegisteredProject(value: unknown): RegisteredProject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid registered project.');
  }
  const project = value as Partial<RegisteredProject>;
  if (
    typeof project.id !== 'string' ||
    !project.id ||
    typeof project.realPath !== 'string' ||
    !project.realPath ||
    typeof project.agent !== 'string' ||
    !agentIds.has(project.agent)
  ) {
    throw new Error('Invalid registered project.');
  }
  if (project.historyPath !== undefined && typeof project.historyPath !== 'string') {
    throw new Error('Invalid registered project.');
  }
  return {
    id: project.id,
    agent: project.agent,
    realPath: project.realPath,
    ...(project.historyPath ? { historyPath: project.historyPath } : {}),
  };
}

function validateOpenTabs(value: unknown): SavedOpenTabs {
  const fail = (): never => {
    throw new Error('Invalid open tabs.');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const raw = value as Partial<SavedOpenTabs>;
  if (!Array.isArray(raw.tabs) || !Number.isInteger(raw.activeIndex)) fail();
  const tabs = raw.tabs!.map((tab): SavedTab => {
    const t = tab as Partial<SavedTab> | null;
    if (
      !t ||
      typeof t.projectId !== 'string' ||
      !t.projectId ||
      typeof t.agent !== 'string' ||
      !agentIds.has(t.agent) ||
      (t.sessionId !== null && (typeof t.sessionId !== 'string' || !t.sessionId))
    ) {
      return fail();
    }
    return { projectId: t.projectId, agent: t.agent, sessionId: t.sessionId };
  });
  const activeIndex = raw.activeIndex!;
  if (activeIndex < -1 || activeIndex >= tabs.length) fail();
  return { tabs, activeIndex };
}

function validateRecentFolders(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((p) => typeof p === 'string' && p)) {
    throw new Error('Invalid recent folders.');
  }
  return value.slice(0, MAX_RECENT_FOLDERS);
}

export class PreferencesStore {
  private pending: Promise<unknown> = Promise.resolve();
  private readonly path: string;
  private readonly renameFile: RenameFile;

  constructor(path: string, renameFile: RenameFile = rename) {
    this.path = path;
    this.renameFile = renameFile;
  }

  async read(): Promise<Preferences> {
    await this.pending;
    return this.readDisk();
  }

  private async readDisk(): Promise<Preferences> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return {
        sessionNames: {},
        fontSize: DEFAULT_FONT_SIZE,
        fontFamily: DEFAULT_FONT_FAMILY,
        fontBold: false,
        projects: [],
        recentFolders: [],
        openTabs: { tabs: [], activeIndex: -1 },
        sortOrders: { ...DEFAULT_SORT_ORDERS },
      };
    }
    const data: Preferences = JSON.parse(text);
    if (
      !data ||
      !data.sessionNames ||
      typeof data.sessionNames !== 'object' ||
      Array.isArray(data.sessionNames) ||
      !Array.isArray(data.projects)
    ) {
      throw new Error('Invalid application preferences.');
    }
    validateFontSize(data.fontSize);
    if (!Object.hasOwn(data, 'fontFamily')) data.fontFamily = DEFAULT_FONT_FAMILY;
    data.fontFamily = validateFontFamily(data.fontFamily);
    if (!Object.hasOwn(data, 'fontBold')) data.fontBold = false;
    if (typeof data.fontBold !== 'boolean') throw new Error('Font bold must be a boolean.');
    for (const name of Object.values(data.sessionNames)) validateSessionName(name);
    return {
      ...data,
      projects: data.projects.map(validateRegisteredProject),
      recentFolders: Object.hasOwn(data, 'recentFolders')
        ? validateRecentFolders(data.recentFolders)
        : [],
      openTabs: Object.hasOwn(data, 'openTabs')
        ? validateOpenTabs(data.openTabs)
        : { tabs: [], activeIndex: -1 },
      sortOrders: Object.hasOwn(data, 'sortOrders')
        ? validateSortOrders(data.sortOrders)
        : { ...DEFAULT_SORT_ORDERS },
    };
  }

  private update(change: (data: Preferences) => Preferences): Promise<void> {
    const operation = this.pending.then(async () => {
      const next = change(await this.readDisk());
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2), 'utf-8');
        await renameWithRetry(temporary, this.path, this.renameFile);
      } catch (error) {
        await unlink(temporary).catch((cleanup: NodeJS.ErrnoException) => {
          if (cleanup.code !== 'ENOENT') console.error('Preferences cleanup failed:', cleanup);
        });
        throw error;
      }
    });
    // Failed writes reject their caller but must not poison subsequent updates.
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  async renameSession(agent: AgentId, id: string, title: string): Promise<string> {
    const name = validateSessionName(title);
    if (!id) throw new Error('Session ID is required.');
    await this.update((data) => ({
      ...data,
      sessionNames: { ...data.sessionNames, [`${agent}:${id}`]: name },
    }));
    return name;
  }

  async setFontSize(size: number): Promise<void> {
    validateFontSize(size);
    await this.update((data) => ({ ...data, fontSize: size }));
  }

  async setFontFamily(fontFamily: string): Promise<void> {
    const next = validateFontFamily(fontFamily);
    await this.update((data) => ({ ...data, fontFamily: next }));
  }

  async setFontBold(bold: boolean): Promise<void> {
    if (typeof bold !== 'boolean') throw new Error('Font bold must be a boolean.');
    await this.update((data) => ({ ...data, fontBold: bold }));
  }

  registerProject(project: RegisteredProject): Promise<void> {
    const registered = validateRegisteredProject(project);
    return this.update((data) => ({
      ...data,
      projects: [...data.projects.filter((p) => p.id !== registered.id), registered],
    }));
  }

  addRecentFolder(folder: string): Promise<void> {
    if (typeof folder !== 'string' || !folder.trim()) {
      return Promise.reject(new Error('Recent folder must be a non-empty path.'));
    }
    const key = folder.toLowerCase();
    return this.update((data) => ({
      ...data,
      recentFolders: [folder, ...data.recentFolders.filter((p) => p.toLowerCase() !== key)].slice(
        0,
        MAX_RECENT_FOLDERS,
      ),
    }));
  }

  setSortOrder(panel: SortPanel, key: SortKey): Promise<void> {
    if (!Object.hasOwn(DEFAULT_SORT_ORDERS, panel)) {
      return Promise.reject(new Error('Invalid sort panel.'));
    }
    const next = parseSortKey(key, DEFAULT_SORT_ORDERS[panel]);
    if (next !== key) return Promise.reject(new Error('Invalid sort order.'));
    return this.update((data) => ({ ...data, sortOrders: { ...data.sortOrders, [panel]: next } }));
  }

  setOpenTabs(openTabs: SavedOpenTabs): Promise<void> {
    const next = validateOpenTabs(openTabs);
    return this.update((data) => ({ ...data, openTabs: next }));
  }

  forgetProject(id: string): Promise<void> {
    return this.update((data) => ({ ...data, projects: data.projects.filter((p) => p.id !== id) }));
  }
}

export const preferences = new PreferencesStore(
  join(homedir(), '.claude', 'parallel-agents-preferences.json'),
);
