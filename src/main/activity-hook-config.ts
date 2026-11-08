import type { AgentId } from '../shared/types.ts';

export const OBSERVER_MARKER = 'parallel-agents-status-v1';
export function shellQuote(value: string, platform: NodeJS.Platform): string {
  if (/[\r\n\0]/.test(value)) throw new Error('Invalid observer path');
  if (platform === 'win32') {
    if (/["%!]/.test(value)) throw new Error('Observer path cannot safely be passed to cmd');
    return `"${value}"`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}
export function reporterCommand(
  executable: string,
  script: string,
  event: string,
  platform: NodeJS.Platform,
): string {
  const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  if (platform === 'win32') {
    // PowerShell runs only our fixed script; preserve JSON stdin and suppress all reporter output.
    const source = `# ${OBSERVER_MARKER}\n$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='SilentlyContinue'; try { $env:ELECTRON_RUN_AS_NODE='1'; $inputJson=[Console]::In.ReadToEnd(); $inputJson | & ${psQuote(executable)} ${psQuote(script)} ${psQuote(event)} 2>$null } catch {}; exit 0`;
    return `powershell.exe -NoProfile -EncodedCommand ${Buffer.from(source, 'utf16le').toString('base64')}`;
  }
  return `{ ELECTRON_RUN_AS_NODE=1 PA_ACTIVITY_OBSERVER=${OBSERVER_MARKER} ${shellQuote(executable, platform)} ${shellQuote(script, platform)} ${shellQuote(event, platform)}; } >/dev/null 2>&1; exit 0`;
}
export function hookConfiguration(
  agent: AgentId,
  executable: string,
  script: string,
  platform: NodeJS.Platform,
) {
  const events =
    agent === 'copilot'
      ? [
          'sessionStart',
          'userPromptSubmitted',
          'permissionRequest',
          'notification',
          'preToolUse',
          'postToolUse',
          'agentStop',
          'errorOccurred',
          'sessionEnd',
        ]
      : agent === 'codex'
        ? [
            'SessionStart',
            'UserPromptSubmit',
            'PermissionRequest',
            'PreToolUse',
            'PostToolUse',
            'PreModelRequest',
            'PostModelRequest',
            'Stop',
            'SessionEnd',
          ]
        : [
            'SessionStart',
            'UserPromptSubmit',
            'PermissionRequest',
            'Notification',
            'PreToolUse',
            'PostToolUse',
            'Stop',
            'StopFailure',
            'SessionEnd',
            'Elicitation',
            'ElicitationResult',
          ];
  const hooks: Record<string, unknown[]> = {};
  for (const event of events) {
    const command = reporterCommand(executable, script, event, platform);
    if (agent === 'copilot') {
      hooks[event] = [{ type: 'command', command, timeoutSec: 3 }];
    } else {
      hooks[event] = [
        {
          hooks: [
            {
              type: 'command',
              command,
              timeout: 3,
              ...(agent === 'claude' ? { onFailure: 'continue' } : {}),
            },
          ],
        },
      ];
    }
  }
  return { ...(agent === 'copilot' ? { version: 1 } : {}), hooks };
}
