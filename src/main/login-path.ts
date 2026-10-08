import { execFile } from 'node:child_process';

interface LoginPathOptions {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  run: (
    command: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
  ) => Promise<{ stdout: string }>;
  diagnostic: (message: string) => void;
}

export async function loadLoginPath(overrides: Partial<LoginPathOptions> = {}): Promise<void> {
  const options: LoginPathOptions = {
    platform: process.platform,
    env: process.env,
    run: (command, args, settings) =>
      new Promise((resolve, reject) => {
        execFile(command, args, { ...settings, encoding: 'utf8' }, (error, stdout) => {
          if (error) reject(error);
          else resolve({ stdout });
        });
      }),
    diagnostic: (message) => console.warn(`[login-path] ${message}`),
    ...overrides,
  };
  if (options.platform !== 'darwin' && options.platform !== 'linux') return;
  const shell = options.env.SHELL || (options.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  try {
    const { stdout } = await options.run(
      shell,
      ['-ilc', 'printf "__PARALLEL_AGENTS_PATH__"; /usr/bin/printenv PATH'],
      { env: options.env, timeout: 5000, maxBuffer: 1024 * 1024 },
    );
    const path = stdout.match(/^__PARALLEL_AGENTS_PATH__([^\r\n]*)/m)?.[1];
    if (!path || path.includes('\0')) throw new Error('The login shell returned no usable PATH.');
    options.env.PATH = [...new Set([...(options.env.PATH ?? '').split(':'), ...path.split(':')])]
      .filter(Boolean)
      .join(':');
  } catch (error) {
    options.diagnostic(
      `Could not load login shell PATH; using inherited PATH. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
