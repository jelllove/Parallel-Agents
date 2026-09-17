import { execFile } from 'node:child_process';
import { chmod, lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function git(root, args) {
  return execFileAsync('git', ['--no-pager', '-C', root, ...args], { windowsHide: true });
}

async function effectiveHooks(root) {
  try {
    return (await git(root, ['config', '--get', 'core.hooksPath'])).stdout.replace(/\r?\n$/, '');
  } catch (error) {
    if (error.code === 1) return null;
    throw error;
  }
}

async function inspect(root) {
  const repository = await realpath(
    (await git(root, ['rev-parse', '--show-toplevel'])).stdout.trim(),
  );
  const hooks = join(repository, '.githooks');
  const folder = await lstat(hooks);
  if (folder.isSymbolicLink() || !folder.isDirectory())
    throw new Error('Hook directory must not be a link.');
  const hook = join(hooks, 'pre-commit');
  const file = await lstat(hook);
  if (file.isSymbolicLink() || !file.isFile())
    throw new Error('Pre-commit hook must be a regular file, not a link.');
  const manifest = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
  if (typeof manifest.scripts?.check !== 'string')
    throw new Error('The repository must define npm run check.');

  const current = await effectiveHooks(repository);
  const matching = current !== null && relative(hooks, resolve(repository, current)) === '';
  if (current !== null && !matching) {
    throw new Error(
      `Existing hook policy will not be replaced: ${current || '(explicit empty setting)'}`,
    );
  }
  if (current === null) {
    const defaultPath = resolve(
      repository,
      (await git(repository, ['rev-parse', '--git-path', 'hooks/pre-commit'])).stdout.trim(),
    );
    try {
      const existing = (await readdir(dirname(defaultPath))).filter(
        (name) => !name.endsWith('.sample'),
      );
      if (existing.length) {
        throw new Error(
          `Existing default hooks will not be bypassed: ${existing.sort().join(', ')}`,
        );
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const executable = process.platform === 'win32' || (file.mode & 0o111) !== 0;
  return { repository, hooks, hook, matching, executable, mode: file.mode & 0o777 };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/install-hooks.mjs [--check | --apply]');
    console.log(
      'Default: preview only. --apply changes repository-local Git configuration shared by linked worktrees.',
    );
    return;
  }
  if (args.length > 1 || (args.length && !['--check', '--apply'].includes(args[0]))) {
    throw new Error('Usage: node scripts/install-hooks.mjs [--check | --apply]');
  }
  const state = await inspect(process.cwd());
  if (args[0] === '--apply') {
    if (!state.executable) await chmod(state.hook, state.mode | 0o111);
    await git(state.repository, ['config', '--local', 'core.hooksPath', state.hooks]);
    console.log(
      'Installed repository-local validation hooks. This Git configuration is shared by linked worktrees.',
    );
    return;
  }
  const installed = state.matching && state.executable;
  console.log(
    installed ? 'Validation hooks are installed.' : 'Validation hooks are not installed.',
  );
  console.log(
    'Preview only. Use npm run hooks:install -- --apply to opt in; Git configuration is shared by linked worktrees.',
  );
  if (args[0] === '--check' && !installed) process.exitCode = 1;
}

if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1]))) === (await realpath(fileURLToPath(import.meta.url)))
) {
  await main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
