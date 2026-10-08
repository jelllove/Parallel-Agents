import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { desktopTarget } from './desktop-targets.mjs';

export function packagingArguments(platform, arch, unpacked, configuration) {
  desktopTarget(platform, arch);
  const key = platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux';
  const configured = configuration?.[key]?.target;
  if (!Array.isArray(configured)) throw new Error(`No configured package targets for ${platform}.`);
  const targets = configured
    .filter((target) => target.arch?.includes(arch))
    .map((target) => target.target);
  if (!targets.length || targets.some((name) => typeof name !== 'string' || !name))
    throw new Error(`No configured package targets for ${platform}/${arch}.`);
  // Explicit target names prevent electron-builder from expanding manifest arches again.
  return [`--${key}`, ...(unpacked ? ['dir'] : targets), `--${arch}`, '--publish', 'never'];
}

export function packageDesktop({
  root,
  platform = process.platform,
  arch = process.arch,
  unpacked = false,
  configuration,
  run = spawnSync,
}) {
  desktopTarget(platform, arch);
  const build = configuration ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).build;
  const args = packagingArguments(platform, arch, unpacked, build);
  const result = run(
    process.execPath,
    [
      '--use-env-proxy',
      '--import',
      pathToFileURL(join(root, 'scripts', 'fetch-downloads.mjs')).href,
      join(root, 'node_modules', 'electron-builder', 'cli.js'),
      ...args,
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`electron-builder terminated by ${result.signal}.`);
  if (!Number.isInteger(result.status))
    throw new Error('electron-builder returned no exit status.');
  if (result.status !== 0)
    console.error(`[package-desktop] electron-builder failed (exit ${result.status}).`);
  return result.status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg !== '--dir'))
    throw new Error('Usage: node scripts/package-desktop.mjs [--dir]');
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  process.exitCode = packageDesktop({ root, unpacked: args.includes('--dir') });
}
