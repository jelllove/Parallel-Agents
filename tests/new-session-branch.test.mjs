import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { localBranchDate, suggestedSessionBranch } from '../src/renderer/new-session-branch.ts';

test('new branch suggestions use feat/local YYYYMMDD_title across providers', () => {
  const date = localBranchDate(new Date(2026, 10, 11, 12));
  assert.equal(date, '20261111');
  assert.equal(
    suggestedSessionBranch('Refactor Auth', date, 'a1b2c3d4'),
    'feat/20261111_refactor-auth',
  );
  assert.equal(localBranchDate(new Date(2027, 0, 2)), '20270102');
  assert.equal(localBranchDate(new Date(2026, 11, 31)), '20261231');
});
test('blank and non-Latin titles use a stable suffix and long titles stay Git-safe', () => {
  for (const title of ['', '修复登录', '🙂'])
    assert.equal(
      suggestedSessionBranch(title, '20261111', 'a1b2c3d4'),
      'feat/20261111_session-a1b2c3d4',
    );
  assert.equal(
    suggestedSessionBranch('  Fix / API___auth!  ', '20261111', 'fallback'),
    'feat/20261111_fix-api-auth',
  );
  assert.equal(
    suggestedSessionBranch('a'.repeat(41) + ' b', '20261111', 'fallback'),
    'feat/20261111_' + 'a'.repeat(41),
  );
});
test('date uses the local calendar rather than the UTC day near midnight', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--input-type=module',
      '-e',
      `import { localBranchDate } from './src/renderer/new-session-branch.ts'; console.log(localBranchDate(new Date('2026-11-11T00:30:00Z')));`,
    ],
    { encoding: 'utf8', env: { ...process.env, TZ: 'America/Los_Angeles' } },
  );
  assert.equal(output.trim(), '20261110');
});
