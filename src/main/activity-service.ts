import { app } from 'electron';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, lstat } from 'node:fs/promises';
import { ActivityRuntime } from './activity-runtime.ts';
import type { AgentId } from '../shared/types.ts';
const exec = promisify(execFile);
function probeHelp(agent: AgentId) {
  if (process.platform === 'win32' && ['claude', 'copilot', 'codex'].includes(agent)) {
    return exec(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${agent} --help`], {
      timeout: 5000,
      maxBuffer: 128 * 1024,
      windowsHide: true,
    });
  }
  return exec(
    agent === 'copilot' && process.platform === 'win32' ? 'copilot.exe' : agent,
    ['--help'],
    { timeout: 5000, maxBuffer: 128 * 1024, windowsHide: true },
  );
}
const capabilities = new Map<AgentId, Promise<boolean>>();
let reporterReady: Promise<void> | undefined;
export function ensureActivityReporter() {
  reporterReady ??= (async () => {
    const directory = join(app.getPath('userData'), 'agent-status');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await lstat(directory)).isSymbolicLink())
      throw new Error('Observer directory must not be linked');
    try {
      if ((await lstat(join(directory, 'activity-reporter.cjs'))).isSymbolicLink())
        throw new Error('Observer script must not be linked');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    // Copy only app-owned observer code; the stable destination is private userData, never a CLI home.
    await copyFile(
      join(__dirname, '../../resources/activity-reporter.cjs'),
      join(directory, 'activity-reporter.cjs'),
    );
  })();
  return reporterReady;
}

export const activityRuntime = new ActivityRuntime({
  directory: join(app.getPath('userData'), 'agent-status'),
  executable: process.execPath,
  reporter: join(app.getPath('userData'), 'agent-status', 'activity-reporter.cjs'),
  codexHooksPath: join(process.env.CODEX_HOME || join(app.getPath('home'), '.codex'), 'hooks.json'),
  platform: process.platform,
  async supports(agent) {
    await ensureActivityReporter();
    let capability = capabilities.get(agent);
    if (!capability) {
      capability = probeHelp(agent)
        .then(({ stdout }) =>
          stdout.includes(
            agent === 'claude'
              ? '--settings'
              : agent === 'copilot'
                ? '--plugin-dir'
                : '--dangerously-bypass-hook-trust',
          ),
        )
        .catch(() => false);
      capabilities.set(agent, capability);
    }
    return capability;
  },
});
