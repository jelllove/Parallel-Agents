import { mkdir, readFile, rename, stat, writeFile, unlink } from 'fs/promises';
import { dirname, join, posix, win32 } from 'path';
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
import type { AgentId, RegisteredProject } from '../shared/types.ts';
import {
  AGENT_LAUNCH,
  validateLaunchOptions,
  validateLaunchSettings,
} from '../shared/agent-launch.ts';
import type { AgentLaunchOptions, AgentLaunchSettings } from '../shared/agent-launch.ts';

interface Preferences {
  sessionNames: Record<string, string>;
  fontSize: number;
  fontFamily: FontFamilyId;
  fontBold: boolean;
  projects: RegisteredProject[];
  recentFolders: string[];
  agentLaunchOptions: AgentLaunchSettings;
}

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

export class PreferencesStore {
  private pending: Promise<unknown> = Promise.resolve();
  private readonly path: string;
  private readonly paths: typeof posix;

  constructor(path: string, platform: NodeJS.Platform = process.platform) {
    this.path = path;
    this.paths = platform === 'win32' ? win32 : posix;
  }

  private normalizeFolder(folder: unknown): string {
    if (
      typeof folder !== 'string' ||
      !folder.trim() ||
      folder.includes('\0') ||
      !this.paths.isAbsolute(folder)
    ) {
      throw new Error('Recent folder must be a non-empty absolute path.');
    }
    const normalized = this.paths.normalize(folder);
    return normalized.length > this.paths.parse(normalized).root.length
      ? normalized.replace(this.paths === win32 ? /[\\/]+$/ : /\/+$/, '')
      : normalized;
  }

  private uniqueFolders(folders: string[]): string[] {
    const seen = new Set<string>();
    return folders
      .map((folder) => this.normalizeFolder(folder))
      .filter((folder) => {
        const key = this.paths === win32 ? folder.toLowerCase() : folder;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
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
        agentLaunchOptions: {},
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
    const projects = data.projects.map(validateRegisteredProject);
    if (Object.hasOwn(data, 'recentFolders') && !Array.isArray(data.recentFolders))
      throw new Error('Invalid recent folders.');
    const recentFolders = this.uniqueFolders([
      ...(data.recentFolders ?? []),
      ...projects
        .map((project) => project.realPath)
        .reverse()
        .filter((path) => this.paths.isAbsolute(path)),
    ]);
    const agentLaunchOptions = Object.hasOwn(data, 'agentLaunchOptions')
      ? validateLaunchSettings(data.agentLaunchOptions)
      : {};
    return { ...data, projects, recentFolders, agentLaunchOptions };
  }

  private update(change: (data: Preferences) => Preferences): Promise<void> {
    const operation = this.pending.then(async () => {
      const next = change(await this.readDisk());
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2), 'utf-8');
        await rename(temporary, this.path);
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

  async addRecentFolder(folder: string): Promise<void> {
    const path = this.normalizeFolder(folder);
    if (!(await stat(path)).isDirectory())
      throw new Error('Recent folder must be an existing directory.');
    await this.update((data) => ({
      ...data,
      recentFolders: this.uniqueFolders([path, ...data.recentFolders]),
    }));
  }

  async setAgentLaunchOptions(
    agent: AgentId,
    options: AgentLaunchOptions,
    acknowledged = false,
  ): Promise<void> {
    const validated = validateLaunchOptions(agent, options);
    const mode = AGENT_LAUNCH[agent].modes.find((mode) => mode.id === validated.approvalMode)!;
    if (mode.risky && acknowledged !== true)
      throw new Error('Acknowledge the reduced-approval risk before saving this mode.');
    await this.update((data) => ({
      ...data,
      agentLaunchOptions: { ...data.agentLaunchOptions, [agent]: validated },
    }));
  }

  registerProject(project: RegisteredProject, baseFolders: string[] = []): Promise<void> {
    const registered = validateRegisteredProject(project);
    const folders = this.uniqueFolders([registered.realPath, ...baseFolders]);
    return this.update((data) => ({
      ...data,
      projects: [...data.projects.filter((p) => p.id !== registered.id), registered],
      recentFolders: this.uniqueFolders([...folders, ...data.recentFolders]),
    }));
  }

  forgetProject(id: string): Promise<void> {
    return this.update((data) => ({ ...data, projects: data.projects.filter((p) => p.id !== id) }));
  }
}

export const preferences = new PreferencesStore(
  join(homedir(), '.claude', 'parallel-agents-preferences.json'),
);
