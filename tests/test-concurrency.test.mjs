import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('normal and coverage runs bound worker contention without reducing test selection', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of ['test', 'test:coverage']) {
    assert.match(manifest.scripts[name], /(?:^|\s)--test-concurrency=4(?:\s|$)/);
    assert.ok(manifest.scripts[name].endsWith('tests/*.test.mjs'));
    assert.match(manifest.scripts[name], /--import \.\/tests\/helpers\/isolated-git\.mjs/);
  }
});
