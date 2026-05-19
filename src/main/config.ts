import { app } from 'electron';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import type { AppConfig } from '../shared/types';

const CONFIG_PATH = join(app.getPath('home'), '.claude', 'parallel-agents.json');
const DEFAULT: AppConfig = { pinned: [], hidden: [] };

let cache: AppConfig | null = null;

export async function loadConfig(): Promise<AppConfig> {
  if (cache) return cache;
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    cache = { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    cache = { ...DEFAULT };
  }
  return cache!;
}

export async function saveConfig(cfg: AppConfig): Promise<void> {
  cache = cfg;
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}
