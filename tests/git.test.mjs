import './helpers/isolated-git.mjs';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  attachWindow,
  detachWindow,
  discard,
  getDiff,
  getStatus,
  stage,
  unstage,
  unwatchAll,
  watchRepo,
} from '../src/main/git.ts';

const execFileAsync = promisify(execFile);

async function runGit(repo, ...args) {
  return execFileAsync(
    'git',
    [
      '--no-pager',
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgSign=false',
      '-C',
      repo,
      ...args,
    ],
    { windowsHide: true },
  );
}

async function fixture(t, initialCommit = true) {
  const root = await mkdtemp(join(tmpdir(), 'parallel-agents-git-'));
  t.after(async () => {
    unwatchAll();
    detachWindow();
    await rm(root, { recursive: true, force: true });
  });
  await runGit(root, 'init', '--initial-branch=main');
  await runGit(root, 'config', 'core.autocrlf', 'false');
  await runGit(root, 'config', 'core.hooksPath', join(root, '.git', 'disabled-hooks'));
  if (initialCommit) {
    await writeFile(join(root, 'notes.txt'), 'committed\n');
    await runGit(root, 'add', '--', 'notes.txt');
    await runGit(root, 'commit', '-m', 'Initial fixture');
  }
  return root;
}

async function nestedFixture(t) {
  const repo = await fixture(t);
  const project = join(repo, 'nested project');
  const file = join(project, 'inner notes.txt');
  const path = 'nested project/inner notes.txt';
  await mkdir(project);
  await writeFile(file, 'committed nested content\n');
  await runGit(repo, 'add', '--', path);
  await runGit(repo, 'commit', '-m', 'Nested fixture');
  return { repo, project, file, path };
}

test('concurrent initial status requests share the Git availability check', async (t) => {
  const repo = await fixture(t);
  const statuses = await Promise.all([getStatus(repo), getStatus(repo)]);
  for (const status of statuses) assert.equal(status?.branch, 'main');
});

test('staged diffs resolve status paths from the worktree root for nested projects', async (t) => {
  const { repo, project, file, path } = await nestedFixture(t);
  await writeFile(file, 'staged nested content\n');
  await runGit(repo, 'add', '--', path);
  await writeFile(file, 'working nested content\n');

  const status = await getStatus(project);
  assert.equal(status.changes[0].path, path);
  assert.deepEqual(await getDiff(project, path, true), {
    oldContent: 'committed nested content\n',
    newContent: 'staged nested content\n',
    oldLabel: 'HEAD',
    newLabel: 'index',
  });
});

test('unstaged diffs read the real working file for nested projects', async (t) => {
  const { repo, project, file, path } = await nestedFixture(t);
  await writeFile(file, 'staged nested content\n');
  await runGit(repo, 'add', '--', path);
  await writeFile(file, 'working nested content\n');

  assert.deepEqual(await getDiff(project, path, false), {
    oldContent: 'staged nested content\n',
    newContent: 'working nested content\n',
    oldLabel: 'index',
    newLabel: 'working tree',
  });
});

test('nested projects stage repository-root-relative status paths', async (t) => {
  const { repo, project, file, path } = await nestedFixture(t);
  await writeFile(file, 'working nested content\n');

  await stage(project, [path]);

  assert.equal((await runGit(repo, 'show', `:${path}`)).stdout, 'working nested content\n');
});

test('nested projects unstage status paths without discarding working content', async (t) => {
  const { repo, project, file, path } = await nestedFixture(t);
  await writeFile(file, 'working nested content\n');
  await runGit(repo, 'add', '--', path);

  await unstage(project, [path]);

  assert.equal((await runGit(repo, 'diff', '--cached', '--name-only')).stdout, '');
  assert.equal(await readFile(file, 'utf8'), 'working nested content\n');
});

test('nested projects discard only the requested root-relative file', async (t) => {
  const { repo, project, file, path } = await nestedFixture(t);
  await writeFile(file, 'working nested content\n');
  await writeFile(join(repo, 'notes.txt'), 'unrelated working content\n');

  await discard(project, [path]);

  assert.equal(await readFile(file, 'utf8'), 'committed nested content\n');
  assert.equal(await readFile(join(repo, 'notes.txt'), 'utf8'), 'unrelated working content\n');
});

test('unstaged diff compares the index with the working tree', async (t) => {
  const repo = await fixture(t);
  await writeFile(join(repo, 'notes.txt'), 'staged\n');
  await runGit(repo, 'add', '--', 'notes.txt');
  await writeFile(join(repo, 'notes.txt'), 'working\n');

  assert.deepEqual(await getDiff(repo, 'notes.txt', false), {
    oldContent: 'staged\n',
    newContent: 'working\n',
    oldLabel: 'index',
    newLabel: 'working tree',
  });
});

test('staged diff compares HEAD with the index, not later working changes', async (t) => {
  const repo = await fixture(t);
  await writeFile(join(repo, 'notes.txt'), 'staged\n');
  await runGit(repo, 'add', '--', 'notes.txt');
  await writeFile(join(repo, 'notes.txt'), 'working\n');

  assert.deepEqual(await getDiff(repo, 'notes.txt', true), {
    oldContent: 'committed\n',
    newContent: 'staged\n',
    oldLabel: 'HEAD',
    newLabel: 'index',
  });
});

test('a staged rename compares the original path with the new index path', async (t) => {
  const repo = await fixture(t);
  await rename(join(repo, 'notes.txt'), join(repo, 'renamed notes.txt'));
  await runGit(repo, 'add', '-A');

  const diff = await getDiff(repo, 'renamed notes.txt', true);
  assert.equal(diff.oldContent, 'committed\n');
  assert.equal(diff.newContent, 'committed\n');
  assert.equal(diff.oldLabel, 'HEAD');
});

test('newly staged files can be compared before the first commit', async (t) => {
  const repo = await fixture(t, false);
  await writeFile(join(repo, 'first.txt'), 'first version\n');
  await stage(repo, ['first.txt']);

  const diff = await getDiff(repo, 'first.txt', true);
  assert.equal(diff.oldContent, '');
  assert.equal(diff.oldLabel, '(new file)');
  assert.equal(diff.newContent, 'first version\n');
});

test('unstaging before the first commit preserves later working changes', async (t) => {
  const repo = await fixture(t, false);
  await writeFile(join(repo, 'first.txt'), 'staged\n');
  await stage(repo, ['first.txt']);
  await writeFile(join(repo, 'first.txt'), 'working\n');

  await unstage(repo, ['first.txt']);

  assert.equal(await readFile(join(repo, 'first.txt'), 'utf8'), 'working\n');
  assert.equal((await runGit(repo, 'ls-files')).stdout, '');
});

test('deleted working files keep the index content as the diff base', async (t) => {
  const repo = await fixture(t);
  await writeFile(join(repo, 'notes.txt'), 'staged\n');
  await stage(repo, ['notes.txt']);
  await rm(join(repo, 'notes.txt'));

  const diff = await getDiff(repo, 'notes.txt', false);
  assert.equal(diff.oldContent, 'staged\n');
  assert.equal(diff.newContent, '');
  assert.equal(diff.newLabel, '(deleted)');
});

test('untracked files have an empty diff base', async (t) => {
  const repo = await fixture(t);
  await writeFile(join(repo, 'new file.txt'), 'new content\n');

  const diff = await getDiff(repo, 'new file.txt', false);
  assert.equal(diff.oldContent, '');
  assert.equal(diff.oldLabel, '(new file)');
  assert.equal(diff.newContent, 'new content\n');
});

test('filesystem errors are not misreported as deleted files', async (t) => {
  const repo = await fixture(t);
  await mkdir(join(repo, 'directory'));

  await assert.rejects(getDiff(repo, 'directory', false));
});

test('diff failures in a non-repository are surfaced', async (t) => {
  const repo = await fixture(t);
  await mkdir(join(repo, 'not-a-repo'));
  await rm(join(repo, '.git'), { recursive: true, force: true });

  await assert.rejects(getDiff(repo, 'notes.txt', false));
});

test('staging a filename treats bracket characters literally', async (t) => {
  const repo = await fixture(t);
  await writeFile(join(repo, 'file[ab].txt'), 'selected\n');
  await writeFile(join(repo, 'filea.txt'), 'not selected\n');
  await writeFile(join(repo, 'fileb.txt'), 'not selected\n');

  await stage(repo, ['file[ab].txt']);

  const result = await runGit(repo, 'diff', '--cached', '--name-only');
  assert.equal(result.stdout.trim(), 'file[ab].txt');
});

test('untracked nested files are listed individually instead of as directories', async (t) => {
  const repo = await fixture(t);
  await mkdir(join(repo, 'nested'));
  await writeFile(join(repo, 'nested', 'new.txt'), 'content\n');

  const status = await getStatus(repo);
  assert.deepEqual(
    status.changes.map((change) => change.path),
    ['nested/new.txt'],
  );
});

test('linked-worktree index changes notify without waiting for the polling fallback', async (t) => {
  const repo = await fixture(t);
  const linked = join(repo, 'linked');
  await runGit(repo, 'worktree', 'add', '-b', 'linked', linked);

  let notify;
  const changed = new Promise((resolve) => {
    notify = resolve;
  });
  attachWindow({
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel, path) => {
        if (channel === 'git:changed' && path === linked) notify();
      },
    },
  });
  watchRepo(linked);
  await writeFile(join(linked, 'notes.txt'), 'changed in linked worktree\n');
  await runGit(linked, 'add', '--', 'notes.txt');

  let timeout;
  try {
    await Promise.race([
      changed,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('No filesystem notification within 2s')), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
});
