import type {
  AgentId,
  AppConfig,
  LayoutConfig,
  PaneId,
  ThemeMode,
  SidebarTreeState,
} from '../shared/types.ts';
import { DEFAULT_AGENT_ORDER } from '../shared/sidebar-order.ts';

const AGENTS: readonly AgentId[] = ['claude', 'codex', 'gemini', 'aider', 'copilot'];
const PANES: readonly PaneId[] = ['sidebar', 'middle', 'right'];

export function defaultConfig(): AppConfig {
  return {
    agentOrder: [...DEFAULT_AGENT_ORDER],
    pinnedAgents: [],
    pinned: [],
    hidden: [],
    lastAgentByProject: {},
    projectOrder: {} as Record<AgentId, string[]>,
    layout: { order: ['sidebar', 'middle', 'right'], sizes: [20, 58, 22] },
    theme: 'dark',
    confirmOnCloseTab: true,
    terminalMultilineEnter: true,
    terminalCopyPaste: true,
    sidebarTree: {
      collapsedAgents: [],
      expandedProjects: [],
      showHidden: false,
    },
  };
}

function invalid(message: string): never {
  throw new TypeError(`Invalid configuration: ${message}`);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    invalid(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${field} must be an array`);
  return Array.from(value);
}

export function projectId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid('project id must be a non-empty string');
  }
  return value;
}

export function projectIds(value: unknown, field = 'project ids'): string[] {
  return array(value, field).map(projectId);
}

export function agentId(value: unknown): AgentId {
  const agent = AGENTS.find((candidate) => candidate === value);
  if (!agent) invalid('agent must be claude, codex, gemini, aider, or copilot');
  return agent;
}

export function agentIds(value: unknown, field: string): AgentId[] {
  const ids = array(value, field).map(agentId);
  if (new Set(ids).size !== ids.length) invalid(`${field} must contain unique agents`);
  return ids;
}

export function agentOrderSetting(value: unknown): AgentId[] {
  const ids = agentIds(value, 'agentOrder');
  if (ids.length !== AGENTS.length) invalid('agentOrder must contain every agent exactly once');
  return ids;
}

export function booleanSetting(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') invalid(`${field} must be a boolean`);
  return value;
}

export function themeSetting(value: unknown): ThemeMode {
  if (value !== 'dark' && value !== 'light') invalid('theme must be dark or light');
  return value;
}

export function sidebarTreeSetting(value: unknown): Omit<SidebarTreeState, 'agentOrder'> {
  const tree = object(value, 'sidebarTree');
  const agentOrder = Object.hasOwn(tree, 'agentOrder')
    ? array(tree.agentOrder, 'sidebarTree.agentOrder').map(agentId)
    : [...DEFAULT_AGENT_ORDER];
  if (agentOrder.length !== AGENTS.length || new Set(agentOrder).size !== AGENTS.length) {
    invalid('sidebarTree.agentOrder must contain each agent exactly once');
  }
  return {
    collapsedAgents: [
      ...new Set(array(tree.collapsedAgents, 'sidebarTree.collapsedAgents').map(agentId)),
    ],
    expandedProjects: [
      ...new Set(projectIds(tree.expandedProjects, 'sidebarTree.expandedProjects')),
    ],
    showHidden: booleanSetting(tree.showHidden, 'sidebarTree.showHidden'),
  };
}

export function layoutSetting(value: unknown): LayoutConfig {
  const layout = object(value, 'layout');
  const order = array(layout.order, 'layout.order');
  const sizes = array(layout.sizes, 'layout.sizes');
  if (
    order.length !== 3 ||
    !order.every((pane: unknown): pane is PaneId =>
      PANES.some((candidate) => candidate === pane),
    ) ||
    new Set(order).size !== 3
  ) {
    invalid('layout.order must contain sidebar, middle, and right exactly once');
  }
  if (
    sizes.length !== 3 ||
    !sizes.every(
      (size: unknown): size is number =>
        typeof size === 'number' && Number.isFinite(size) && size >= 0 && size <= 100,
    ) ||
    Math.abs(sizes.reduce((sum, size) => sum + size, 0) - 100) > 0.01 + Number.EPSILON * 100
  ) {
    invalid('layout.sizes must contain three finite percentages totaling 100');
  }
  const hiddenPanes = Object.hasOwn(layout, 'hiddenPanes')
    ? array(layout.hiddenPanes, 'layout.hiddenPanes')
    : undefined;
  if (
    hiddenPanes &&
    (hiddenPanes.some((pane) => pane !== 'sidebar' && pane !== 'right') ||
      new Set(hiddenPanes).size !== hiddenPanes.length)
  ) {
    invalid(
      'layout.hiddenPanes must contain unique sidebar/right pane names; the terminal cannot be hidden',
    );
  }
  return {
    order: [order[0], order[1], order[2]],
    sizes: [sizes[0], sizes[1], sizes[2]],
    ...(hiddenPanes
      ? { hiddenPanes: hiddenPanes.map((pane) => (pane === 'sidebar' ? 'sidebar' : 'right')) }
      : {}),
  };
}

export function validateConfig(value: unknown): AppConfig {
  const raw = object(value, 'root');
  const defaults = defaultConfig();
  const field = (key: keyof AppConfig): unknown =>
    Object.hasOwn(raw, key) ? raw[key] : defaults[key];
  const lastAgentByProject: Record<string, AgentId> = Object.fromEntries(
    Object.entries(object(field('lastAgentByProject'), 'lastAgentByProject')).map(
      ([id, agent]): [string, AgentId] => [projectId(id), agentId(agent)],
    ),
  );
  const projectOrder = defaults.projectOrder;
  for (const [agent, ids] of Object.entries(object(field('projectOrder'), 'projectOrder'))) {
    projectOrder[agentId(agent)] = projectIds(ids, `projectOrder.${agent}`);
  }
  return {
    agentOrder: agentOrderSetting(
      Object.hasOwn(raw, 'agentOrder')
        ? raw.agentOrder
        : Object.hasOwn(raw, 'sidebarTree')
          ? (object(raw.sidebarTree, 'sidebarTree').agentOrder ?? defaults.agentOrder)
          : defaults.agentOrder,
    ),
    pinnedAgents: agentIds(field('pinnedAgents'), 'pinnedAgents'),
    pinned: projectIds(field('pinned'), 'pinned'),
    hidden: projectIds(field('hidden'), 'hidden'),
    lastAgentByProject,
    projectOrder,
    layout: layoutSetting(field('layout')),
    theme: themeSetting(field('theme')),
    confirmOnCloseTab: booleanSetting(field('confirmOnCloseTab'), 'confirmOnCloseTab'),
    terminalMultilineEnter: booleanSetting(
      field('terminalMultilineEnter'),
      'terminalMultilineEnter',
    ),
    terminalCopyPaste: booleanSetting(field('terminalCopyPaste'), 'terminalCopyPaste'),
    sidebarTree: sidebarTreeSetting(field('sidebarTree')),
  };
}

export function migrateConfig(config: AppConfig): { config: AppConfig; changed: boolean } {
  let changed = false;
  const migrateProjectId = (id: string): string => {
    if (id.includes(':')) return id;
    changed = true;
    return `claude:${id}`;
  };
  // Legacy IDs were bare Claude directory names; already namespaced IDs stay intact.
  const migrated: AppConfig = {
    ...config,
    pinned: config.pinned.map(migrateProjectId),
    hidden: config.hidden.map(migrateProjectId),
    lastAgentByProject: Object.fromEntries(
      Object.entries(config.lastAgentByProject).map(([id, agent]): [string, AgentId] => [
        migrateProjectId(id),
        agent,
      ]),
    ),
  };
  return { config: migrated, changed };
}
