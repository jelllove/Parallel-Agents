import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { getBuildInfo } from '../scripts/build-info.mjs';

test('build metadata uses package version and full source commit rather than hardcoded values', async () => {
  const root = process.cwd();
  const info = getBuildInfo(root);
  assert.equal(info.version, JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version);
  assert.equal(info.commit, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  assert.equal(typeof info.dirty, 'boolean');
});

test('source archives explicitly report unavailable commit metadata', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pa-build-info-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '2.3.4' }));
  assert.deepEqual(getBuildInfo(root), { version: '2.3.4', commit: null, dirty: false });
});
