import { realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseOptions(args, { allowJson = false } = {}) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--json' && allowJson && !options.json) {
      options.json = true;
    } else if (argument === '--npm-cli' && options.npmCli === undefined) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('--npm-cli requires an absolute path.');
      options.npmCli = value;
    } else {
      throw new Error(`Unknown or repeated option: ${argument}`);
    }
  }
  return options;
}

export function usage(name, { allowJson = false } = {}) {
  const command = `node ${join('scripts', `${name}.mjs`)}`;
  return [
    `Usage: ${command} ${allowJson ? '[--json] ' : ''}[--npm-cli <absolute-path-to-npm-cli.js>]`,
    `       ${command} --help`,
    `Run from the repository root. Prefer npm run ${name}.`,
    ...(allowJson ? ['For JSON without npm banners: npm --silent run doctor -- --json.'] : []),
    'npm scripts supply npm_execpath; direct Node invocation must supply --npm-cli when it is absent.',
    'npm runs as process.execPath + the npm CLI JavaScript entry point, never via npm.cmd or a shell fallback.',
    'Exit codes: 0 success, 1 unmet prerequisites, 2 invalid arguments.',
  ].join('\n');
}

export function resolveNpmCli(npmCli, env) {
  const path = npmCli ?? env.npm_execpath;
  if (!path) {
    throw new Error(
      'npm_execpath is absent. Use npm run doctor / npm run setup, or supply --npm-cli <absolute-path-to-npm-cli.js> for direct Node invocation.',
    );
  }
  if (!isAbsolute(path) || basename(path) !== 'npm-cli.js') {
    throw new Error(
      'npm CLI must be an absolute path to npm-cli.js, not npm.cmd or another launcher.',
    );
  }
  if (!statSync(path).isFile()) throw new Error('npm CLI must be a file: ' + path);
  return { path: resolve(path), source: npmCli === undefined ? 'npm_execpath' : '--npm-cli' };
}

export function commandFailure(result) {
  if (result.error) return result.error.code || result.error.message;
  if (result.signal) return `terminated by ${result.signal}`;
  if (result.status !== 0) return `exit status ${result.status ?? 'unavailable'}`;
  return null;
}

export function commandExitCode(result) {
  return Number.isInteger(result.status) && result.status > 0 && result.status < 256
    ? result.status
    : 1;
}

export function isMain(url) {
  return (
    Boolean(process.argv[1]) &&
    process.argv[1] !== '-' &&
    realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(url))
  );
}
