import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { gitEnvironment } from './worktrees.ts';
import type { WorkspaceRef, WorkspaceRepository } from '../shared/workspace-repository.ts';
const exec = promisify(execFile);

export async function inspectWorkspaceRepository(path: string): Promise<WorkspaceRepository> {
  if (typeof path !== 'string' || path.length > 4096 || path.includes('\0') || !isAbsolute(path))
    throw new Error('Choose an absolute project folder.');
  const empty: WorkspaceRepository = {
    exists: false,
    isGit: false,
    root: null,
    hasHead: false,
    currentBranch: null,
    defaultRef: 'HEAD',
    refs: [],
  };
  try {
    if (!(await stat(path)).isDirectory()) return empty;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty;
    throw error;
  }
  const env = gitEnvironment();
  const run = (directory: string, args: string[]) =>
    exec('git', ['--no-pager', '-C', directory, ...args], {
      env,
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
  let root: string;
  try {
    root = (await run(path, ['rev-parse', '--show-toplevel'])).stdout.trim();
  } catch (error) {
    if (
      (error as { code?: number }).code === 128 &&
      /not a git repository/i.test((error as { stderr?: string }).stderr ?? '')
    )
      return { ...empty, exists: true };
    throw error;
  }
  if (!root) throw new Error('Git did not identify this repository.');
  const git = (args: string[]) => run(root, args);
  const [refsResult, branchResult, headResult] = await Promise.all([
    git([
      'for-each-ref',
      '--format=%(refname)%00%(symref)',
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ]),
    git(['symbolic-ref', '--quiet', '--short', 'HEAD']).catch((error: unknown) => {
      if ((error as { code?: number }).code === 1) return { stdout: '' };
      throw error;
    }),
    git(['rev-parse', '--verify', '--quiet', '--end-of-options', 'HEAD^{commit}']).then(
      () => true,
      (error: unknown) => {
        if ((error as { code?: number }).code === 1) return false;
        throw error;
      },
    ),
  ]);
  const refs: WorkspaceRef[] = refsResult.stdout.split(/\r?\n/).flatMap((line) => {
    if (!line) return [];
    const [value, symbolic] = line.split('\0');
    if (symbolic) return [];
    const kind = value.startsWith('refs/heads/')
      ? 'local'
      : value.startsWith('refs/remotes/')
        ? 'remote'
        : 'tag';
    const label =
      value.replace(/^refs\/(heads|remotes|tags)\//, '') + (kind === 'tag' ? ' (tag)' : '');
    return [{ value, label, kind }];
  });
  const preferred = ['refs/heads/main', 'refs/heads/master', 'refs/heads/develop'];
  const rank = (ref: WorkspaceRef) =>
    preferred.includes(ref.value)
      ? preferred.indexOf(ref.value)
      : ref.kind === 'local'
        ? 3
        : ref.kind === 'remote'
          ? 4
          : 5;
  refs.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
  return {
    exists: true,
    isGit: true,
    root,
    hasHead: headResult,
    currentBranch: branchResult.stdout.trim() || null,
    defaultRef: preferred.find((ref) => refs.some((item) => item.value === ref)) ?? 'HEAD',
    refs,
  };
}
