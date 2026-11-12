import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { withoutRepositoryGitEnvironment } from './git-environment.mjs';
import { providerShim } from './desktop-targets.mjs';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceEntry = process.env.PA_PERFORMANCE_MAIN ?? join(root, 'out/main/index.js');
const label = process.argv[2] ?? 'current';
if (!/^[a-zA-Z0-9-]+$/.test(label)) throw new Error('Use an alphanumeric performance label');
await access(sourceEntry);
const reports = await mkdtemp(join(root, 'reports', `performance-${label}-`));
const home = await mkdtemp(join(tmpdir(), 'pa-performance-'));
try {
  const bin = join(home, 'bin');
  await mkdir(bin);
  for (let project = 0; project < 100; project++) {
    const path = join(home, `repo-${String(project).padStart(3, '0')}`);
    const histories = join(home, '.claude', 'projects', `fixture-${project}`);
    await mkdir(path);
    await mkdir(histories, { recursive: true });
    for (let session = 0; session < (project === 99 ? 1000 : 10); session++)
      await writeFile(
        join(histories, `session-${project}-${session}.jsonl`),
        JSON.stringify({
          type: 'user',
          cwd: path,
          timestamp: '2026-01-01T00:00:00Z',
          message: { content: `Performance fixture ${project}-${session}` },
        }) + '\n',
      );
  }
  const runtime = require('electron');
  const shim = join(root, 'tests/helpers/performance-agent.cjs');
  for (const agent of ['claude', 'copilot', 'codex', 'gemini', 'aider']) {
    const fallback = providerShim(agent, process.platform);
    const content =
      agent === 'claude'
        ? process.platform === 'win32'
          ? `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${runtime}" "${shim}" %*\r\n`
          : `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 '${runtime.replace(/'/g, "'\\''")}' '${shim.replace(/'/g, "'\\''")}' "$@"\n`
        : fallback.content;
    await writeFile(join(bin, fallback.name), content, { mode: 0o755 });
  }
  const env = withoutRepositoryGitEnvironment(process.env);
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, 'config'),
    XDG_DATA_HOME: join(home, 'data'),
    XDG_CACHE_HOME: join(home, 'cache'),
  });
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = `${bin}${delimiter}${env[pathKey] ?? ''}`;
  if (process.platform !== 'win32') {
    env.SHELL = '/bin/sh';
    env.ZDOTDIR = home;
    delete env.BASH_ENV;
    delete env.ENV;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const result = await exec(
    runtime,
    [join(root, 'tests/e2e/performance.cjs'), home, reports, sourceEntry],
    { cwd: root, env, windowsHide: true, timeout: 240_000, maxBuffer: 1024 * 1024 },
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  console.log(`Performance evidence: ${reports}`);
} catch (error) {
  if (typeof error.stdout === 'string') process.stdout.write(error.stdout);
  if (typeof error.stderr === 'string') process.stderr.write(error.stderr);
  throw error;
} finally {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
