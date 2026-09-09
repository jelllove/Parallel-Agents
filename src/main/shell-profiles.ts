import type { SessionShellProfile } from '../shared/session-terminals';

export interface ShellLaunch {
  command: string;
  args: string[];
}

export function resolveShellLaunch(
  platform: NodeJS.Platform,
  profile: SessionShellProfile,
  envShell: string | null,
): ShellLaunch {
  if (platform === 'win32') {
    if (profile === 'bash') return { command: 'bash.exe', args: [] };
    if (profile === 'cmd') return { command: 'cmd.exe', args: [] };
    if (profile === 'powershell') return { command: 'pwsh.exe', args: [] };
    return { command: 'powershell.exe', args: [] };
  }

  if (profile === 'bash') return { command: 'bash', args: ['-l'] };
  const command = envShell && envShell.trim() ? envShell : 'bash';
  return { command, args: ['-l'] };
}
