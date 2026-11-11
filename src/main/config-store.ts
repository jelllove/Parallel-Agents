import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  reconcileArrangement,
  moveArrangement,
  promoteArrangement,
} from '../shared/sidebar-arrangement.ts';
import type { ArrangementItem, SessionArrangement } from '../shared/sidebar-arrangement.ts';
import { groupProjectTrees } from '../shared/project-tree.ts';
import type {
  AgentId,
  AgentLayout,
  AppConfig,
  LayoutConfig,
  ThemeMode,
  SidebarTreeState,
  Project,
} from '../shared/types.ts';
import {
  agentId,
  agentOrderSetting,
  booleanSetting,
  defaultConfig,
  layoutSetting,
  migrateConfig,
  projectId,
  projectIds,
  themeSetting,
  sidebarTreeSetting,
  validateConfig,
} from './config-schema.ts';

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createConfigStore(configPath: string) {
  let cache: AppConfig | null = null;
  let queue = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function persist(config: AppConfig): Promise<void> {
    const stagingPath = `${configPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(configPath), { recursive: true });
      let written = false;
      try {
        await writeFile(stagingPath, JSON.stringify(config, null, 2), {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        });
        written = true;
        await rename(stagingPath, configPath);
      } catch (error) {
        // An exclusive-open collision must not remove another writer's file.
        if (written || !hasCode(error, 'EEXIST')) {
          try {
            await unlink(stagingPath);
          } catch (cleanupError) {
            if (!hasCode(cleanupError, 'ENOENT')) {
              throw new AggregateError(
                [error, cleanupError],
                `${message(error)}; staging-file cleanup failed: ${message(cleanupError)}`,
                { cause: cleanupError },
              );
            }
          }
        }
        throw error;
      }
    } catch (error) {
      throw new Error(`Failed to save configuration at ${configPath}: ${message(error)}`, {
        cause: error,
      });
    }
  }

  async function readCurrent(): Promise<AppConfig> {
    if (cache) return cache;
    let text: string;
    try {
      text = await readFile(configPath, 'utf8');
    } catch (error) {
      if (hasCode(error, 'ENOENT')) {
        cache = defaultConfig();
        return cache;
      }
      throw new Error(`Failed to read configuration at ${configPath}: ${message(error)}`, {
        cause: error,
      });
    }
    let migrated: ReturnType<typeof migrateConfig>;
    try {
      const parsed: unknown = JSON.parse(text);
      migrated = migrateConfig(validateConfig(parsed));
    } catch (error) {
      throw new Error(`Invalid configuration at ${configPath}: ${message(error)}`, {
        cause: error,
      });
    }
    if (migrated.changed) await persist(migrated.config);
    cache = migrated.config;
    return cache;
  }

  function loadConfig(): Promise<AppConfig> {
    return enqueue(async () => structuredClone(await readCurrent()));
  }

  async function saveConfig(config: AppConfig): Promise<void> {
    const snapshot = validateConfig(config);
    await enqueue(async () => {
      await readCurrent();
      await persist(snapshot);
      cache = snapshot;
    });
  }

  function updateConfig(update: (current: AppConfig) => AppConfig): Promise<void> {
    return enqueue(async () => {
      const next = validateConfig(update(await readCurrent()));
      await persist(next);
      cache = next;
    });
  }

  function sessionArrangement(
    scope: string,
    change: (saved: SessionArrangement | undefined) => SessionArrangement,
  ): Promise<SessionArrangement> {
    if (typeof scope !== 'string' || !scope || scope.length > 4096)
      return Promise.reject(new Error('Invalid session order scope.'));
    return enqueue(async () => {
      const current = await readCurrent();
      const arrangement = structuredClone(
        current.sidebarArrangement ?? { version: 1 as const, projects: {}, sessions: {} },
      );
      const group = change(arrangement.sessions[scope]);
      arrangement.sessions[scope] = group;
      const next = validateConfig({ ...current, sidebarArrangement: arrangement });
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        await persist(next);
        cache = next;
      }
      return structuredClone(group);
    });
  }

  async function setProjectFlag(
    field: 'pinned' | 'hidden',
    id: string,
    enabled: boolean,
  ): Promise<void> {
    const key = projectId(id);
    const value = booleanSetting(enabled, field);
    await updateConfig((config) => {
      const ids = new Set(config[field]);
      if (value) ids.add(key);
      else ids.delete(key);
      return { ...config, [field]: [...ids] };
    });
  }

  async function setBoolean(
    field: 'confirmOnCloseTab' | 'terminalMultilineEnter' | 'terminalCopyPaste',
    value: boolean,
  ): Promise<void> {
    const validated = booleanSetting(value, field);
    await updateConfig((config) => ({ ...config, [field]: validated }));
  }

  return {
    loadConfig,
    saveConfig,
    async getAgentLayout(): Promise<AgentLayout> {
      const { agentOrder, pinnedAgents } = await loadConfig();
      return { agentOrder, pinnedAgents };
    },
    async setAgentOrder(ids: AgentId[]): Promise<void> {
      const order = agentOrderSetting(ids);
      await updateConfig((config) => ({ ...config, agentOrder: order }));
    },
    async setAgentPinned(agent: AgentId, pinned: boolean): Promise<void> {
      const key = agentId(agent);
      const enabled = booleanSetting(pinned, 'pinnedAgents');
      await updateConfig((config) => {
        const ids = new Set(config.pinnedAgents);
        if (enabled) ids.add(key);
        else ids.delete(key);
        return { ...config, pinnedAgents: [...ids] };
      });
    },
    setProjectPinned: (id: string, pinned: boolean) => setProjectFlag('pinned', id, pinned),
    setProjectHidden: (id: string, hidden: boolean) => setProjectFlag('hidden', id, hidden),
    async setLastAgent(id: string, agent: AgentId): Promise<void> {
      const key = projectId(id);
      const value = agentId(agent);
      await updateConfig((config) => ({
        ...config,
        lastAgentByProject: { ...config.lastAgentByProject, [key]: value },
      }));
    },
    async getLastAgent(id: string): Promise<AgentId | null> {
      const key = projectId(id);
      const config = await loadConfig();
      return Object.hasOwn(config.lastAgentByProject, key) ? config.lastAgentByProject[key] : null;
    },
    reconcileProjectOrder(
      projects: (Pick<Project, 'id' | 'agent'> & Partial<Project>)[],
    ): Promise<AppConfig> {
      const snapshot = projects.map(
        (project) =>
          ({
            ...project,
            id: projectId(project.id),
            agent: agentId(project.agent),
            realPath: project.realPath ?? project.id,
          }) as Project,
      );
      return enqueue(async () => {
        const current = await readCurrent();
        const arrangement = structuredClone(
          current.sidebarArrangement ?? { version: 1 as const, projects: {}, sessions: {} },
        );
        const order = structuredClone(current.projectOrder);
        for (const agent of new Set(snapshot.map((project) => project.agent))) {
          const members = snapshot.filter((project) => project.agent === agent);
          const saved = arrangement.projects[agent];
          const next = reconcileArrangement(
            saved ??
              (current.projectOrder[agent]?.length
                ? {
                    ids: [...current.projectOrder[agent]],
                    createdAt: Object.fromEntries(
                      current.projectOrder[agent].map((id) => [
                        id,
                        members.find((project) => project.id === id)?.createdAt ?? Date.now(),
                      ]),
                    ),
                    manual: false,
                  }
                : undefined),
            members.map((project) => ({ key: project.id, createdAt: project.createdAt })),
          );
          const groups = groupProjectTrees(members, true);
          for (const group of groups) {
            const anchor = `group:${group.id}`;
            next.createdAt[anchor] ??= Math.min(
              ...group.projects.map((project) => next.createdAt[project.id]),
            );
          }
          if (!next.manual) {
            groups.sort(
              (a, b) =>
                next.createdAt[`group:${a.id}`] - next.createdAt[`group:${b.id}`] ||
                a.id.localeCompare(b.id),
            );
            const visible = groups.flatMap((group) => group.projects.map((project) => project.id));
            const missing = next.ids.filter((id) => !members.some((project) => project.id === id));
            next.ids = [...visible];
            for (const id of missing) {
              const prior = saved?.ids.indexOf(id) ?? -1;
              next.ids.splice(
                prior < 0 ? next.ids.length : Math.min(prior, next.ids.length),
                0,
                id,
              );
            }
          } else {
            // Newly discovered worktree members join their established parent without moving it.
            const groupById = new Map(
              groups.flatMap((group) =>
                group.projects.map((project) => [project.id, group.id] as const),
              ),
            );
            const seen = new Set<string>();
            next.ids = next.ids.flatMap((id) => {
              const groupId = groupById.get(id);
              if (!groupId) return [id];
              if (seen.has(groupId)) return [];
              seen.add(groupId);
              return next.ids.filter((member) => groupById.get(member) === groupId);
            });
          }
          arrangement.projects[agent] = next;
          order[agent] = next.ids;
        }
        const next = validateConfig({
          ...current,
          sidebarArrangement: arrangement,
          projectOrder: order,
        });
        if (JSON.stringify(next) !== JSON.stringify(current)) {
          await persist(next);
          cache = next;
        }
        return structuredClone(cache ?? current);
      });
    },
    reconcileSessionOrder(scope: string, items: ArrangementItem[]): Promise<SessionArrangement> {
      return sessionArrangement(scope, (saved) => reconcileArrangement(saved, items));
    },
    moveSessionOrder(
      scope: string,
      items: ArrangementItem[],
      from: string,
      to: string,
      placement: 'before' | 'after',
    ): Promise<SessionArrangement> {
      if (!items.some((item) => item.key === from) || !items.some((item) => item.key === to))
        return Promise.reject(new Error('The session target is stale or no longer available.'));
      if (placement !== 'before' && placement !== 'after')
        return Promise.reject(new Error('Invalid session placement.'));
      return sessionArrangement(scope, (saved) =>
        moveArrangement(reconcileArrangement(saved, items), from, to, placement),
      );
    },
    promoteSessionOrder(scope: string, draft: string, native: string): Promise<SessionArrangement> {
      return sessionArrangement(scope, (saved) =>
        promoteArrangement(saved ?? reconcileArrangement(undefined, []), draft, native),
      );
    },
    removeSessionOrder(key: string): Promise<void> {
      return updateConfig((config) => {
        if (!config.sidebarArrangement) return config;
        const arrangement = structuredClone(config.sidebarArrangement);
        for (const group of Object.values(arrangement.sessions)) {
          group.ids = group.ids.filter((id) => id !== key);
          delete group.createdAt[key];
        }
        return { ...config, sidebarArrangement: arrangement };
      });
    },
    async setProjectOrder(agent: AgentId, ids: string[]): Promise<void> {
      const key = agentId(agent);
      const order = projectIds(ids);
      await updateConfig((config) => {
        const arrangement = config.sidebarArrangement
          ? structuredClone(config.sidebarArrangement)
          : undefined;
        if (arrangement) {
          const group = reconcileArrangement(
            arrangement.projects[key],
            order.map((id) => ({ key: id })),
          );
          group.ids = [...order, ...group.ids.filter((id) => !order.includes(id))];
          group.manual = true;
          arrangement.projects[key] = group;
        }
        return {
          ...config,
          projectOrder: { ...config.projectOrder, [key]: arrangement?.projects[key]?.ids ?? order },
          ...(arrangement ? { sidebarArrangement: arrangement } : {}),
        };
      });
    },
    async forgetProject(id: string): Promise<void> {
      const key = projectId(id);
      await updateConfig((config) => {
        const lastAgentByProject = { ...config.lastAgentByProject };
        delete lastAgentByProject[key];
        const projectOrder = { ...config.projectOrder };
        for (const agent of Object.keys(projectOrder)) {
          const keyAgent = agentId(agent);
          projectOrder[keyAgent] = projectOrder[keyAgent].filter((project) => project !== key);
        }
        const arrangement = config.sidebarArrangement
          ? structuredClone(config.sidebarArrangement)
          : undefined;
        if (arrangement)
          for (const group of Object.values(arrangement.projects)) {
            group.ids = group.ids.filter((id) => id !== key);
            delete group.createdAt[key];
          }
        return {
          ...config,
          ...(arrangement ? { sidebarArrangement: arrangement } : {}),
          pinned: config.pinned.filter((project) => project !== key),
          hidden: config.hidden.filter((project) => project !== key),
          lastAgentByProject,
          projectOrder,
        };
      });
    },
    async getLayout(): Promise<LayoutConfig> {
      return (await loadConfig()).layout;
    },
    async getSidebarTree(): Promise<SidebarTreeState> {
      const config = await loadConfig();
      return { ...config.sidebarTree, agentOrder: config.agentOrder };
    },
    async setSidebarTree(tree: SidebarTreeState): Promise<void> {
      const validated = sidebarTreeSetting(tree);
      const agentOrder = agentOrderSetting(tree.agentOrder);
      await updateConfig((config) => ({ ...config, agentOrder, sidebarTree: validated }));
    },
    async setLayout(layout: LayoutConfig): Promise<void> {
      const validated = layoutSetting(layout);
      await updateConfig((config) => ({ ...config, layout: validated }));
    },
    async getTheme(): Promise<ThemeMode> {
      return (await loadConfig()).theme;
    },
    async setTheme(theme: ThemeMode): Promise<void> {
      const validated = themeSetting(theme);
      await updateConfig((config) => ({ ...config, theme: validated }));
    },
    async getConfirmOnCloseTab(): Promise<boolean> {
      return (await loadConfig()).confirmOnCloseTab;
    },
    setConfirmOnCloseTab: (value: boolean) => setBoolean('confirmOnCloseTab', value),
    async getTerminalMultilineEnter(): Promise<boolean> {
      return (await loadConfig()).terminalMultilineEnter;
    },
    setTerminalMultilineEnter: (value: boolean) => setBoolean('terminalMultilineEnter', value),
    async getTerminalCopyPaste(): Promise<boolean> {
      return (await loadConfig()).terminalCopyPaste;
    },
    setTerminalCopyPaste: (value: boolean) => setBoolean('terminalCopyPaste', value),
  };
}
