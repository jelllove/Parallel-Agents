import './helpers/isolated-git.mjs';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { createSourceSnapshot, scannerArguments } from '../scripts/scan-secrets.mjs';

const execFileAsync = promisify(execFile);

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'parallel-agents-secrets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await execFileAsync('git', ['-C', root, 'init', '--initial-branch=main']);
  return root;
}

test('source snapshots include untracked source but exclude ignored files and generated outputs', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, '.gitignore'), 'private.txt\nreports/\n');
  await writeFile(join(root, 'visible.mjs'), 'export const value = 1;\n');
  await writeFile(join(root, 'private.txt'), 'must not be read');
  await mkdir(join(root, 'reports'));
  await writeFile(join(root, 'reports', 'previous.json'), '{"private":true}');
  const snapshot = await createSourceSnapshot(root);
  t.after(snapshot.cleanup);
  assert.ok(snapshot.files.includes('visible.mjs'));
  assert.ok(!snapshot.files.includes('private.txt'));
  assert.ok(!snapshot.files.some((path) => path.startsWith('reports/')));
  assert.equal(
    await readFile(join(snapshot.directory, 'visible.mjs'), 'utf8'),
    'export const value = 1;\n',
  );
  assert.equal(await readFile(join(root, 'private.txt'), 'utf8'), 'must not be read');
});

test('source snapshots do not follow links to data outside the checkout', async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await writeFile(join(outside, 'private.txt'), 'outside data');
  await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createSourceSnapshot(root), /link/i);
  assert.equal(await readFile(join(outside, 'private.txt'), 'utf8'), 'outside data');
});

test('binary media is excluded explicitly while ordinary source is preserved', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'image.png'), Buffer.from([0, 1, 2]));
  await writeFile(join(root, 'README.md'), '# Source\n');
  const snapshot = await createSourceSnapshot(root);
  t.after(snapshot.cleanup);
  assert.deepEqual(snapshot.excludedBinaryFiles, ['image.png']);
  assert.ok(snapshot.files.includes('README.md'));
  assert.ok(!snapshot.files.includes('image.png'));
});

test('source size limits fail explicitly instead of silently omitting large code', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'large.js'), 'a'.repeat(50));
  await assert.rejects(createSourceSnapshot(root, { maxFileBytes: 20 }), /size|limit/i);
  assert.equal((await readFile(join(root, 'large.js'), 'utf8')).length, 50);
});

test('scanner arguments always redact findings and distinguish findings from tool failures', () => {
  const args = scannerArguments('snapshot', 'config', 'report');
  assert.ok(args.includes('--redact=100'));
  assert.ok(args.includes('--exit-code=10'));
  assert.ok(args.includes('--timeout=120'));
  assert.ok(args.includes('--ignore-gitleaks-allow'));
  assert.ok(!args.includes('--follow-symlinks'));
});

test('snapshot cleanup removes only its generated directory', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'keep.md'), 'keep');
  const snapshot = await createSourceSnapshot(root);
  await snapshot.cleanup();
  await assert.rejects(readdir(snapshot.directory), { code: 'ENOENT' });
  assert.equal(await readFile(join(root, 'keep.md'), 'utf8'), 'keep');
});
