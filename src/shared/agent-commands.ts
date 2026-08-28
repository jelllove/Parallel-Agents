import type { AgentId } from './types';

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

export function resumeCommandFor(id: AgentId, sessionId: string): string {
  const bin = START_COMMAND[id];
  switch (id) {
    case 'claude': return `${bin} --resume ${sessionId}`;
    case 'codex': return `${bin} resume ${sessionId}`;
    case 'gemini': return `${bin} --resume ${sessionId}`;
    case 'aider': return `${bin} --restore-chat-history`;
    case 'copilot': return `${bin} --resume=${sessionId}`;
  }
}
