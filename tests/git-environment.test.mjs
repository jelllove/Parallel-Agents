import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

import { withoutRepositoryGitEnvironment } from '../scripts/git-environment.mjs';

const execFileAsync = promisify(execFile);

test('Git repository-local state never leaks into independent operations', async () => {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--local-env-vars']);
  const names = stdout.trim().split(/\r?\n/);
  const original = Object.fromEntries(names.map((name) => [name, 'caller-state']));
  original.GIT_CONFIG_KEY_0 = 'core.hooksPath';
  original.GIT_CONFIG_VALUE_0 = 'caller-hook';
  original.PATH = 'preserved path';
  original.GIT_CONFIG_GLOBAL = 'explicit user configuration';
  const clean = withoutRepositoryGitEnvironment(original);
  for (const name of names) assert.equal(clean[name], undefined, name);
  assert.equal(clean.GIT_CONFIG_KEY_0, undefined);
  assert.equal(clean.GIT_CONFIG_VALUE_0, undefined);
  assert.equal(clean.PATH, original.PATH);
  assert.equal(clean.GIT_CONFIG_GLOBAL, original.GIT_CONFIG_GLOBAL);
  assert.equal(original.GIT_INDEX_FILE, 'caller-state');
});

test('Git environment isolation handles Windows case-insensitive variable names', () => {
  const clean = withoutRepositoryGitEnvironment({
    Git_Index_File: 'caller-index',
    Git_Dir: 'caller-git',
    Home: 'keep',
  });
  assert.deepEqual(clean, { Home: 'keep' });
});
