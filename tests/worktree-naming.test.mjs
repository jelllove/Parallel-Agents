import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultWorktreePath, worktreeBranchName } from '../src/shared/worktree-naming.ts';

test('worktree paths live under <folder>.worktree next to the repository', () => {
  assert.equal(
    defaultWorktreePath('C:\\work\\repo', 'fix-login'),
    'C:\\work\\repo.worktree\\fix-login',
  );
  assert.equal(defaultWorktreePath('C:\\work\\repo\\', 'a/b'), 'C:\\work\\repo.worktree\\a-b');
  assert.equal(defaultWorktreePath('/home/me/repo', 'x'), '/home/me/repo.worktree/x');
  assert.equal(defaultWorktreePath('C:\\work\\repo', ''), '');
});

test('the branch defaults to the worktree name with unsafe characters replaced', () => {
  assert.equal(worktreeBranchName('fix login'), 'fix-login');
  assert.equal(worktreeBranchName('feature/new'), 'feature/new');
  assert.equal(worktreeBranchName('  '), '');
});
