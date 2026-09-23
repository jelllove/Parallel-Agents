import assert from 'node:assert/strict';
import test from 'node:test';

import { SORT_KEYS, parseSortKey, sortBy } from '../src/shared/sorting.ts';

const items = [
  { name: 'beta', created: 2, modified: 30 },
  { name: 'Alpha', created: 5, modified: 10 },
  { name: 'gamma', created: null, modified: null },
  { name: 'alpha 10', created: 1, modified: 20 },
  { name: 'alpha 2', created: 1, modified: 20 },
];
const fields = { name: (i) => i.name, created: (i) => i.created, modified: (i) => i.modified };

test('created and modified sort newest first with missing dates last', () => {
  assert.deepEqual(
    sortBy(items, 'created', fields).map((i) => i.name),
    ['Alpha', 'beta', 'alpha 2', 'alpha 10', 'gamma'],
  );
  assert.deepEqual(
    sortBy(items, 'modified', fields).map((i) => i.name),
    ['beta', 'alpha 2', 'alpha 10', 'Alpha', 'gamma'],
  );
});

test('name sorts case-insensitively with natural numbers', () => {
  assert.deepEqual(
    sortBy(items, 'name', fields).map((i) => i.name),
    ['Alpha', 'alpha 2', 'alpha 10', 'beta', 'gamma'],
  );
});

test('custom keeps the incoming order and unknown stored keys fall back to the default', () => {
  assert.deepEqual(sortBy(items, 'custom', fields), items);
  assert.equal(parseSortKey('modified', 'created'), 'modified');
  assert.equal(parseSortKey('bogus', 'created'), 'created');
  assert.equal(parseSortKey(null, 'created'), 'created');
  assert.ok(SORT_KEYS.includes('created'));
});
