import { execFile } from 'child_process';
import { lstat, realpath, stat } from 'fs/promises';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const repositoryGitEnvironmentKeys = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
];

function gitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of repositoryGitEnvironmentKeys) delete env[key];
  return env;
}

async function git(basePath: string, args: string[], context: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', basePath, ...args], {
      env: gitEnvironment(),
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout.trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(
      `${context}: ${stderr || (error instanceof Error ? error.message : String(error))}`,
      { cause: error },
    );
  }
}

function validateAbsolutePath(value: string, name: string): void {
  if (
    typeof value !== 'string' ||
    !isAbsolute(value) ||
    (process.platform === 'win32' && !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(value))
  ) {
    throw new Error(`${name} must be an absolute path.`);
  }
}

async function requireMissingTarget(targetPath: string): Promise<void> {
  try {
    await lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Target path already exists: ${targetPath}`);
}

async function resolveTargetPath(targetPath: string): Promise<string> {
  const missingParts = [basename(targetPath)];
  let parent = dirname(targetPath);
  while (true) {
    try {
      await lstat(parent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      missingParts.unshift(basename(parent));
      const nextParent = dirname(parent);
      if (nextParent === parent) {
        throw new Error(`Cannot access target parent: ${parent}`, { cause: error });
      }
      parent = nextParent;
      continue;
    }
    if (!(await stat(parent)).isDirectory()) {
      throw new Error(`Target parent is not a directory: ${parent}`);
    }
    // Resolve existing ancestors so symlinks/junctions cannot hide a nested target.
    return join(await realpath(parent), ...missingParts);
  }
}

function requireOutsideWorkingTree(targetPath: string, workingTree: string): void {
  const subpath = relative(workingTree, targetPath);
  if (
    subpath === '' ||
    (!isAbsolute(subpath) && subpath !== '..' && !subpath.startsWith(`..${sep}`))
  ) {
    throw new Error(`Target path must not be inside the base working tree: ${workingTree}`);
  }
}

export async function findProjectRepositoryRoot(basePath: string): Promise<string | null> {
  let directory = await realpath(basePath);
  while (true) {
    try {
      await lstat(join(directory, '.git'));
      return normalize(
        await git(directory, ['rev-parse', '--show-toplevel'], 'Cannot resolve project repository'),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export interface RepositoryIdentity {
  commonDir: string;
  mainPath: string;
}

function comparablePath(p: string): string {
  const n = normalize(p);
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

export async function repositoryIdentity(folder: string): Promise<RepositoryIdentity | null> {
  let root: string | null;
  try {
    root = await findProjectRepositoryRoot(folder);
  } catch {
    return null;
  }
  if (!root) return null;
  let commonDir: string;
  try {
    commonDir = await git(
      root,
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      'Cannot resolve Git common directory',
    );
  } catch {
    return null;
  }
  const resolved = normalize(await realpath(commonDir).catch(() => commonDir));
  const mainPath =
    basename(resolved).toLowerCase() === '.git' ? normalize(dirname(resolved)) : normalize(root);
  return { commonDir: comparablePath(resolved), mainPath };
}

export async function latestDefaultBranchStartPoint(basePath: string): Promise<string> {
  const remotes = (await git(basePath, ['remote'], 'Cannot list Git remotes'))
    .split(/\r?\n/)
    .filter(Boolean);
  if (remotes.includes('origin')) {
    await git(basePath, ['fetch', '--prune', 'origin'], 'Failed to fetch the latest origin');
    try {
      const head = await git(
        basePath,
        ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
        'No origin default branch',
      );
      if (head) return head;
    } catch {
      // origin/HEAD is not always set; fall back to the conventional names below.
    }
    for (const name of ['main', 'master']) {
      try {
        await git(
          basePath,
          ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}`],
          'Missing ref',
        );
        return `origin/${name}`;
      } catch {
        // try next
      }
    }
  }
  for (const name of ['main', 'master']) {
    try {
      await git(
        basePath,
        ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`],
        'Missing ref',
      );
      return name;
    } catch {
      // try next
    }
  }
  throw new Error('Cannot find a main or master branch to start the worktree from.');
}

export async function createProjectWorktree(options: {
  basePath: string;
  branch: string;
  startPoint: string;
  targetPath: string;
}): Promise<string> {
  validateAbsolutePath(options.basePath, 'Base path');
  validateAbsolutePath(options.targetPath, 'Target path');
  const targetPath = resolve(options.targetPath);
  let basePath: string;
  try {
    basePath = await realpath(options.basePath);
    if (!(await stat(basePath)).isDirectory()) throw new Error('Not a directory');
  } catch (error) {
    throw new Error(
      `Cannot access base directory: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const workingTree = normalize(
    await realpath(
      await git(
        basePath,
        ['rev-parse', '--show-toplevel'],
        'Base directory must be a Git working tree',
      ),
    ),
  );
  await git(
    basePath,
    ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'],
    'Base repository must have a HEAD commit',
  );
  const { branch } = options;
  if (typeof branch !== 'string' || !branch || branch.startsWith('-') || branch.includes('@{-')) {
    throw new Error('Invalid branch name: specify a new literal branch name.');
  }
  await git(basePath, ['check-ref-format', '--branch', branch], 'Invalid branch name');
  const startPoint = options.startPoint || 'HEAD';
  const commit = await git(
    basePath,
    ['rev-parse', '--verify', '--end-of-options', `${startPoint}^{commit}`],
    `Invalid start point "${startPoint}"; expected a commit`,
  );

  await requireMissingTarget(targetPath);
  requireOutsideWorkingTree(targetPath, workingTree);
  const actualTargetPath = await resolveTargetPath(targetPath);
  requireOutsideWorkingTree(actualTargetPath, workingTree);
  await requireMissingTarget(actualTargetPath);
  await git(
    basePath,
    ['worktree', 'add', '--no-track', '-b', branch, actualTargetPath, commit],
    'Failed to create Git worktree',
  );
  return normalize(await realpath(actualTargetPath));
}
