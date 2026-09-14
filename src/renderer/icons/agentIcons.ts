import type { AgentId } from '../../shared/types';
import claudeUrl from '../assets/agents/claude.png';
import codexUrl from '../assets/agents/codex-transparent.png';
import geminiUrl from '../assets/agents/gemini.svg';
import aiderUrl from '../assets/agents/aider.svg';
import copilotUrl from '../assets/agents/copilot.svg';
export { resumeCommandFor, startCommandFor } from '../../shared/agent-commands';

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

export function extraPathFor(resolvedPath?: string | null): string[] {
  if (!resolvedPath) return [];
  const m = resolvedPath.match(/^(.*)[\\/][^\\/]+$/);
  return m ? [m[1]] : [];
}
