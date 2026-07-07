import { app } from 'electron';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import type { AppConfig, AgentId, LayoutConfig, ThemeMode } from '../shared/types';

const CONFIG_PATH = join(app.getPath('home'), '.claude', 'parallel-agents.json');
const DEFAULT_LAYOUT: LayoutConfig = {
  order: ['sidebar', 'middle', 'right'],
  sizes: [20, 58, 22],
};
const DEFAULT: AppConfig = {
  pinned: [],
  hidden: [],
  lastAgentByProject: {},
  projectOrder: {} as Record<AgentId, string[]>,
  layout: DEFAULT_LAYOUT,
  theme: 'dark',
  confirmOnCloseTab: true,
  terminalMultilineEnter: true,
  terminalCopyPaste: true,
};

let cache: AppConfig | null = null;

// Old config stored bare Claude dirNames (e.g. "C--jelllove-foo"). New scheme namespaces
// project ids as "<agent>:<dirName>". Migrate once on first load.
function migrateProjectId(key: string): string {
  return key.includes(':') ? key : `claude:${key}`;
}

function migrate(cfg: AppConfig): { cfg: AppConfig; changed: boolean } {
  let changed = false;
  const pinned = cfg.pinned.map((k) => {
    const m = migrateProjectId(k);
    if (m !== k) changed = true;
    return m;
  });
  const hidden = cfg.hidden.map((k) => {
    const m = migrateProjectId(k);
    if (m !== k) changed = true;
    return m;
  });
  const lastAgentByProject: Record<string, AgentId> = {};
  for (const [k, v] of Object.entries(cfg.lastAgentByProject)) {
    const m = migrateProjectId(k);
    if (m !== k) changed = true;
    lastAgentByProject[m] = v;
  }
  const projectOrder = cfg.projectOrder ?? ({} as Record<AgentId, string[]>);
  if (!cfg.projectOrder) changed = true;
  let layout = cfg.layout;
  if (!layout || !Array.isArray(layout.order) || layout.order.length !== 3
    || !Array.isArray(layout.sizes) || layout.sizes.length !== 3) {
    layout = DEFAULT_LAYOUT;
    changed = true;
  }
  let theme = cfg.theme;
  if (theme !== 'dark' && theme !== 'light') {
    theme = 'dark';
    changed = true;
  }
  let confirmOnCloseTab = cfg.confirmOnCloseTab;
  if (typeof confirmOnCloseTab !== 'boolean') {
    confirmOnCloseTab = true;
    changed = true;
  }
  let terminalMultilineEnter = cfg.terminalMultilineEnter;
  if (typeof terminalMultilineEnter !== 'boolean') {
    terminalMultilineEnter = true;
    changed = true;
  }
  let terminalCopyPaste = cfg.terminalCopyPaste;
  if (typeof terminalCopyPaste !== 'boolean') {
    terminalCopyPaste = true;
    changed = true;
  }
  return {
    cfg: {
      pinned, hidden, lastAgentByProject, projectOrder, layout, theme,
      confirmOnCloseTab, terminalMultilineEnter, terminalCopyPaste,
    },
    changed,
  };
}

export async function loadConfig(): Promise<AppConfig> {
  if (cache) return cache;
  let raw: AppConfig;
  try {
    const text = await readFile(CONFIG_PATH, 'utf-8');
    raw = { ...DEFAULT, ...JSON.parse(text) };
  } catch {
    raw = { ...DEFAULT };
  }
  const { cfg, changed } = migrate(raw);
  cache = cfg;
  if (changed) {
    void saveConfig(cfg);
  }
  return cache!;
}

export async function saveConfig(cfg: AppConfig): Promise<void> {
  cache = cfg;
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

export async function setLastAgent(projectId: string, agentId: AgentId): Promise<void> {
  const cfg = await loadConfig();
  await saveConfig({
    ...cfg,
    lastAgentByProject: { ...cfg.lastAgentByProject, [projectId]: agentId },
  });
}

export async function getLastAgent(projectId: string): Promise<AgentId | null> {
  const cfg = await loadConfig();
  return cfg.lastAgentByProject[projectId] ?? null;
}

export async function setProjectOrder(agent: AgentId, ids: string[]): Promise<void> {
  const cfg = await loadConfig();
  await saveConfig({
    ...cfg,
    projectOrder: { ...cfg.projectOrder, [agent]: ids },
  });
}

export async function forgetProject(projectId: string): Promise<void> {
  const cfg = await loadConfig();
  const lastAgent = { ...cfg.lastAgentByProject };
  delete lastAgent[projectId];
  const projectOrder = { ...cfg.projectOrder } as Record<AgentId, string[]>;
  for (const [agent, ids] of Object.entries(projectOrder)) {
    projectOrder[agent as AgentId] = ids.filter((id) => id !== projectId);
  }
  await saveConfig({
    ...cfg,
    pinned: cfg.pinned.filter((id) => id !== projectId),
    hidden: cfg.hidden.filter((id) => id !== projectId),
    lastAgentByProject: lastAgent,
    projectOrder,
  });
}

export async function getLayout(): Promise<LayoutConfig> {
  const cfg = await loadConfig();
  return cfg.layout;
}

export async function setLayout(layout: LayoutConfig): Promise<void> {
  const cfg = await loadConfig();
  await saveConfig({ ...cfg, layout });
}

export async function getTheme(): Promise<ThemeMode> {
  const cfg = await loadConfig();
  return cfg.theme;
}

export async function setTheme(theme: ThemeMode): Promise<void> {
  const cfg = await loadConfig();
  await saveConfig({ ...cfg, theme });
}

export async function getConfirmOnCloseTab(): Promise<boolean> {
  const cfg = await loadConfig();
  return cfg.confirmOnCloseTab;
}

export async function setConfirmOnCloseTab(v: boolean): Promise<void> {
  const cfg = await loadConfig();
  await saveConfig({ ...cfg, confirmOnCloseTab: v });
}

export async function getTerminalMultilineEnter(): Promise<boolean> {
  const cfg = await loadConfig();
  return cfg.terminalMultilineEnter;
}

export async function setTerminalMultilineEnter(v: boolean): Promise<void> {
  const cfg = await loadConfig();
  await saveConfig({ ...cfg, terminalMultilineEnter: v });
}

export async function getTerminalCopyPaste(): Promise<boolean> {
  const cfg = await loadConfig();
  return cfg.terminalCopyPaste;
}

export async function setTerminalCopyPaste(v: boolean): Promise<void> {
  const cfg = await loadConfig();
  await saveConfig({ ...cfg, terminalCopyPaste: v });
}
