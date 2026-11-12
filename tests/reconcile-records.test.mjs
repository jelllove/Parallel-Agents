import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileRecords } from '../src/renderer/store/reconcile-records.ts';
test('unchanged snapshots retain arrays and individual records, while changed records publish', () => {
  const old = [
    { id: 'one', title: 'One' },
    { id: 'two', title: 'Two' },
  ];
  assert.equal(reconcileRecords(old, structuredClone(old)), old);
  const next = reconcileRecords(old, [
    { id: 'one', title: 'Changed' },
    { id: 'two', title: 'Two' },
  ]);
  assert.notEqual(next, old);
  assert.equal(next[1], old[1]);
  assert.equal(next[0].title, 'Changed');
  assert.deepEqual(reconcileRecords(old, []), []);
  assert.equal(reconcileRecords(old, [old[1], old[0]])[0], old[1]);
});
