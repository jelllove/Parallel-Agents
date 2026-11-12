import assert from 'node:assert/strict';
import test from 'node:test';
import { windowedRows } from '../src/renderer/windowed-rows.ts';
test('large session offsets preserve height and bound visible rows while pinning keyboard neighbors', () => {
  const keys = Array.from({ length: 1000 }, (_, i) => `row-${i}`);
  const rows = windowedRows(keys, new Map([['row-0', 60]]), 10000, 10600, ['row-900']);
  assert.ok(rows.filter((r) => r.visible).length < 20);
  assert.equal(rows.at(-1).top + rows.at(-1).height, 50010);
  for (const i of [899, 900, 901]) assert.equal(rows[i].visible, true);
  assert.equal(rows[0].visible, false);
});
test('font estimates and actual measured rows retain all logical identities', () => {
  const keys = ['one', 'two', 'three'];
  const rows = windowedRows(keys, new Map([['two', 80]]), -Infinity, Infinity, [], 70);
  assert.deepEqual(
    rows.map((r) => r.top),
    [0, 70, 150],
  );
  assert.deepEqual(
    rows.map((r) => r.key),
    keys,
  );
  assert.ok(rows.every((r) => r.visible));
});
