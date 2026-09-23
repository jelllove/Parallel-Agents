import assert from 'node:assert/strict';
import test from 'node:test';

import { reviewChangedFiles, matchesGlob } from '../scripts/review-learned-rules.mjs';

const corpus = {
  schemaVersion: 1,
  maxActiveRules: 5,
  rules: [
    { id: 'active-tests', state: 'active', summary: 'Tests rule', appliesTo: ['tests/**'] },
    {
      id: 'active-scripts',
      state: 'active',
      summary: 'Scripts rule',
      appliesTo: ['scripts/*.mjs'],
    },
    { id: 'candidate', state: 'candidate', summary: 'Ignored', appliesTo: ['**'] },
    { id: 'retired', state: 'retired', summary: 'Ignored', appliesTo: ['**'] },
  ],
};

test('glob matching supports ** and * without crossing path separators', () => {
  assert.equal(matchesGlob('tests/a/b.test.mjs', 'tests/**'), true);
  assert.equal(matchesGlob('scripts/a.mjs', 'scripts/*.mjs'), true);
  assert.equal(matchesGlob('scripts/sub/a.mjs', 'scripts/*.mjs'), false);
  assert.equal(matchesGlob('src/a.ts', 'tests/**'), false);
});

test('only active rules produce findings for the changed files they cover', () => {
  const report = reviewChangedFiles(corpus, ['tests/x.test.mjs', 'scripts/y.mjs', 'src/z.ts']);
  assert.deepEqual(
    report.findings.map((f) => [f.ruleId, f.files]),
    [
      ['active-tests', ['tests/x.test.mjs']],
      ['active-scripts', ['scripts/y.mjs']],
    ],
  );
  assert.equal(report.reviewedFiles, 3);
  assert.equal(report.activeRules, 2);
  assert.equal(report.mode, 'advisory');
});

test('a change touching no rule scope reports no findings', () => {
  assert.deepEqual(reviewChangedFiles(corpus, ['README.md']).findings, []);
});
