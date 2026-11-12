import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRuntimeDiagnostics } from '../src/main/runtime-diagnostics.ts';
test('runtime failure metadata is local, serialized and rotates at a bounded size', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pa-diagnostics-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'runtime.jsonl');
  const record = createRuntimeDiagnostics(path, 'fixture-version');
  await Promise.all([
    record({ event: 'renderer-gone', reason: 'crashed', exitCode: 1 }),
    record({ event: 'child-gone', reason: 'oom', exitCode: 2, processType: 'GPU' }),
  ]);
  const entries = (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].version, 'fixture-version');
  assert.equal(entries[1].processType, 'GPU');
  await writeFile(path, 'x'.repeat(256 * 1024));
  await record({ event: 'renderer-gone', reason: 'crashed', exitCode: 3 });
  assert.ok((await readFile(path, 'utf8')).length < 1000);
  assert.equal((await readFile(path + '.previous', 'utf8')).length, 256 * 1024);
});
