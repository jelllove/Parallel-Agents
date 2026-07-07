import type { AgentId } from '../../shared/types';
import claudeUrl from '../assets/agents/claude.png';
import codexUrl from '../assets/agents/codex.png';
import geminiUrl from '../assets/agents/gemini.svg';
import aiderUrl from '../assets/agents/aider.svg';
import copilotUrl from '../assets/agents/copilot.svg';

export const AGENT_ICON: Record<AgentId, string> = {
  claude: claudeUrl,
  codex: codexUrl,
  gemini: geminiUrl,
  aider: aiderUrl,
  copilot: copilotUrl,
};

export function agentIconUrl(id: AgentId): string {
  return AGENT_ICON[id];
}

const START_COMMAND: Record<AgentId, string> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  aider: 'aider',
  copilot: 'copilot',
};

export function startCommandFor(id: AgentId): string {
  return START_COMMAND[id];
}

export function resumeCommandFor(id: AgentId, sessionId: string): string | null {
  const bin = START_COMMAND[id];
  switch (id) {
    case 'claude': return `${bin} --resume ${sessionId}`;
    case 'codex': return `${bin} resume ${sessionId}`;
    case 'gemini': return `${bin} --resume ${sessionId}`;
    case 'aider': return `${bin} --restore-chat-history`;
    case 'copilot': return null;
  }
}

export function extraPathFor(resolvedPath?: string | null): string[] {
  if (!resolvedPath) return [];
  const m = resolvedPath.match(/^(.*)[\\/][^\\/]+$/);
  return m ? [m[1]] : [];
}

