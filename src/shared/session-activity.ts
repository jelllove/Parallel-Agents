import type { AgentId } from './types.ts';

export type ActivityState = 'running' | 'waiting' | 'completed' | 'unknown' | 'failed';
export const ACTIVITY_ICON: Record<ActivityState, string> = {
  running: '🏃‍♂️',
  waiting: '❓',
  completed: '✅',
  unknown: '❔',
  failed: '❌',
};
export const ACTIVITY_LABEL: Record<ActivityState, string> = {
  running: 'Processing the current request',
  waiting: 'Waiting for input or permission',
  completed: 'Current turn finished (CLI may still be open)',
  unknown: 'Not running or hook status unavailable',
  failed: 'Agent error or abnormal exit',
};
export interface SessionActivity {
  terminalKey: string;
  generation: string;
  agent: AgentId;
  sessionId: string | null;
  state: ActivityState;
  revision: number;
}

export function activityFromHook(
  agent: AgentId,
  event: string,
  data: Record<string, unknown>,
): ActivityState | null {
  if (data.agent_id || data.agentId || data.parent_agent_id || data.parentAgentId) return null;
  if (!['claude', 'copilot', 'codex'].includes(agent)) return null;
  const name =
    (
      {
        userPromptSubmitted: 'UserPromptSubmit',
        sessionStart: 'SessionStart',
        sessionEnd: 'SessionEnd',
        agentStop: 'Stop',
        permissionRequest: 'PermissionRequest',
        preToolUse: 'PreToolUse',
        postToolUse: 'PostToolUse',
        notification: 'Notification',
        errorOccurred: 'ErrorOccurred',
      } as Record<string, string>
    )[event] ?? event;
  if (
    [
      'UserPromptSubmit',
      'PreModelRequest',
      'PreToolUse',
      'PostToolUse',
      'ElicitationResult',
    ].includes(name)
  )
    return 'running';
  if (['PermissionRequest', 'Elicitation'].includes(name)) return 'waiting';
  if (name === 'Notification')
    return ['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog'].includes(
      String(data.notification_type),
    )
      ? 'waiting'
      : null;
  if (name === 'Stop') return 'completed';
  if (name === 'StopFailure') return 'failed';
  if (name === 'ErrorOccurred') return data.recoverable === false ? 'failed' : null;
  if (name === 'PostModelRequest') return data.status === 'failed' ? 'failed' : null;
  if (name === 'SessionEnd')
    return ['error', 'timeout'].includes(String(data.reason)) ? 'failed' : 'unknown';
  if (name === 'SessionStart') return 'unknown';
  return null;
}
