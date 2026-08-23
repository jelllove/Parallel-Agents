import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { AgentId, AgentInfo, AgentStatus } from '../shared/types';

const execAsync = promisify(exec);

interface ProviderDef extends AgentInfo {
  binary: string;
  startArgs: string;
  resumeCommand: (sessionId: string) => string;
  resumeLast: string | null;
  fallbackPaths?: () => string[];
}

const PROVIDERS: Record<AgentId, ProviderDef> = {
  claude: {
    id: 'claude',
    displayName: 'Claude Code',
    iconAsset: 'claude.png',
    binary: 'claude',
    startArgs: '',
    resumeCommand: (id) => `claude --resume ${id}`,
    resumeLast: 'claude --continue',
    hasResume: true,
    installHint: 'npm i -g @anthropic-ai/claude-code',
    installUrl: 'https://docs.claude.com/claude-code',
  },
  codex: {
    id: 'codex',
    displayName: 'Codex CLI',
    iconAsset: 'codex.png',
    binary: 'codex',
    startArgs: '',
    resumeCommand: (id) => `codex resume ${id}`,
    resumeLast: 'codex resume --last',
    hasResume: true,
    installHint: 'npm i -g @openai/codex',
    installUrl: 'https://github.com/openai/codex',
  },
  gemini: {
    id: 'gemini',
    displayName: 'Gemini CLI',
    iconAsset: 'gemini.svg',
    binary: 'gemini',
    startArgs: '',
    resumeCommand: (id) => `gemini --resume ${id}`,
    resumeLast: 'gemini --resume',
    hasResume: true,
    installHint: 'npm i -g @google/gemini-cli',
    installUrl: 'https://github.com/google-gemini/gemini-cli',
  },
  aider: {
    id: 'aider',
    displayName: 'Aider',
    iconAsset: 'aider.svg',
    binary: 'aider',
    startArgs: '',
    resumeCommand: () => 'aider --restore-chat-history',
    resumeLast: 'aider --restore-chat-history',
    hasResume: true,
    installHint: 'python -m pip install aider-install && aider-install',
    installUrl: 'https://aider.chat',
  },
  copilot: {
    id: 'copilot',
    displayName: 'GitHub Copilot',
    iconAsset: 'copilot.svg',
    binary: 'copilot',
    startArgs: '',
    resumeCommand: () => 'copilot',
    resumeLast: null,
    hasResume: false,
    installHint: 'npm i -g @github/copilot',
    installUrl: 'https://docs.github.com/copilot/concepts/agents/about-copilot-cli',
    fallbackPaths: () => {
      if (process.platform !== 'win32') return [];
      const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
      const wingetPackages = join(local, 'Microsoft', 'WinGet', 'Packages');
      const out: string[] = [join(local, 'Microsoft', 'WinGet', 'Links', 'copilot.exe')];
      try {
        const { readdirSync } = require('fs') as typeof import('fs');
        for (const dir of readdirSync(wingetPackages)) {
          if (dir.startsWith('GitHub.Copilot')) out.push(join(wingetPackages, dir, 'copilot.exe'));
        }
      } catch {
        // ignore — directory may not exist
      }
      return out;
    },
  },
};

export const AGENT_IDS: AgentId[] = ['copilot', 'codex', 'claude', 'gemini', 'aider'];

export function getProvider(id: AgentId): ProviderDef {
  return PROVIDERS[id];
}

export function listAgents(): AgentInfo[] {
  return AGENT_IDS.map((id) => {
    const p = PROVIDERS[id];
    return {
      id: p.id,
      displayName: p.displayName,
      iconAsset: p.iconAsset,
      installHint: p.installHint,
      installUrl: p.installUrl,
      hasResume: p.hasResume,
    };
  });
}

export function startCommandFor(id: AgentId): string {
  const p = PROVIDERS[id];
  return p.startArgs ? `${p.binary} ${p.startArgs}` : p.binary;
}

export function resumeCommandFor(id: AgentId, sessionId: string): string {
  return PROVIDERS[id].resumeCommand(sessionId);
}

async function detectOne(id: AgentId): Promise<AgentStatus> {
  const p = PROVIDERS[id];
  const cmd = process.platform === 'win32' ? `where ${p.binary}` : `which ${p.binary}`;
  try {
    const { stdout } = await execAsync(cmd);
    const path = stdout.split(/\r?\n/).find(Boolean)?.trim() || null;
    if (path) return { available: true, path };
  } catch {
    // fall through to fallback paths
  }
  if (p.fallbackPaths) {
    for (const candidate of p.fallbackPaths()) {
      if (existsSync(candidate)) return { available: true, path: candidate };
    }
  }
  return { available: false, path: null };
}

export async function checkAllAgents(): Promise<Record<AgentId, AgentStatus>> {
  const entries = await Promise.all(AGENT_IDS.map(async (id) => [id, await detectOne(id)] as const));
  return Object.fromEntries(entries) as Record<AgentId, AgentStatus>;
}
