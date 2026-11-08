import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ActivityBridge } from './activity-bridge.ts';
import { CodexStatusHooks } from './codex-status-hooks.ts';
import { hookConfiguration, shellQuote } from './activity-hook-config.ts';
import type { AgentId } from '../shared/types.ts';
import type { ActivityState } from '../shared/session-activity.ts';

interface RuntimeOptions {
  directory: string;
  executable: string;
  reporter: string;
  codexHooksPath: string;
  platform: NodeJS.Platform;
  supports: (agent: AgentId) => Promise<boolean>;
}
export class ActivityRuntime {
  readonly bridge: ActivityBridge;
  readonly codex: CodexStatusHooks;
  private options: RuntimeOptions;
  private startPromise: Promise<void> | null = null;
  private temporary = new Set<string>();
  constructor(options: RuntimeOptions) {
    this.options = options;
    this.bridge = new ActivityBridge(options.directory);
    this.codex = new CodexStatusHooks(
      options.codexHooksPath,
      hookConfiguration('codex', options.executable, options.reporter, options.platform),
    );
  }
  snapshot() {
    return this.bridge.snapshot();
  }
  async prepare(agent: AgentId, terminalKey: string, sessionId: string | null, command: string) {
    const noop = {
      command,
      environment: {} as Record<string, string>,
      configPath: '',
      end: (_state: ActivityState) => {},
    };
    if (!['claude', 'copilot', 'codex'].includes(agent) || !(await this.options.supports(agent)))
      return noop;
    if (agent === 'codex' && !(await this.codex.inspect()).installed) return noop;
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    this.startPromise ??= this.bridge.start();
    await this.startPromise;
    const registration = this.bridge.register(terminalKey, agent, sessionId);
    const environment = {
      PA_ACTIVITY_ENDPOINT: this.bridge.endpoint,
      PA_ACTIVITY_TOKEN: registration.token,
    };
    let configPath = '';
    let directory: string | undefined;
    try {
      if (agent === 'claude' || agent === 'copilot') {
        const dir = await mkdtemp(join(this.options.directory, 'launch-'));
        directory = dir;
        this.temporary.add(dir);
        const config = hookConfiguration(
          agent,
          this.options.executable,
          this.options.reporter,
          this.options.platform,
        );
        if (agent === 'claude') {
          configPath = join(dir, 'settings.json');
          await writeFile(configPath, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
          command += ` --settings ${shellQuote(configPath, this.options.platform)}`;
        } else {
          await mkdir(join(dir, '.claude-plugin'));
          await mkdir(join(dir, 'hooks'));
          await writeFile(
            join(dir, '.claude-plugin', 'plugin.json'),
            JSON.stringify({
              name: 'parallel-agents-status',
              version: '1.0.0',
              description: 'Passive session activity observer',
            }),
          );
          configPath = join(dir, 'hooks', 'hooks.json');
          await writeFile(configPath, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
          command += ` --plugin-dir ${shellQuote(dir, this.options.platform)}`;
        }
      }
    } catch (error) {
      this.bridge.revoke(registration.token);
      if (directory) {
        this.temporary.delete(directory);
        await rm(directory, { recursive: true, force: true });
      }
      throw error;
    }
    return {
      command,
      environment,
      configPath,
      end: (state: ActivityState) => {
        this.bridge.revoke(registration.token, state);
        if (directory) {
          const path = directory;
          this.temporary.delete(path);
          void rm(path, { recursive: true, force: true }).catch(() => {});
        }
      },
    };
  }
  async close() {
    await this.bridge.close();
    for (const directory of this.temporary) await rm(directory, { recursive: true, force: true });
    this.temporary.clear();
  }
}
