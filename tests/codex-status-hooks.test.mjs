import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexStatusHooks } from '../src/main/codex-status-hooks.ts';

test('Codex setup is additive, backed up, idempotent and removes only exact owned hooks', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-status-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'hooks.json');
  const original =
    '{"custom":1,"hooks":{"Stop":[{"hooks":[{"type":"command","command":"existing"}]}]}}';
  await writeFile(path, original);
  const installer = new CodexStatusHooks(path, {
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'owned' }] }] },
  });
  const before = await installer.inspect();
  const installed = await installer.apply(true, before.digest);
  assert.equal(await readFile(installed.backupPath, 'utf8'), original);
  const data = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(data.custom, 1);
  assert.equal(data.hooks.Stop.length, 2);
  await installer.apply(true, (await installer.inspect()).digest);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).hooks.Stop.length, 2);
  await installer.apply(false, (await installer.inspect()).digest);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), JSON.parse(original));
});

test('hook installer refuses linked parent paths and preserves unrelated files', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-status-link-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const real = join(dir, 'real');
  await (await import('node:fs/promises')).mkdir(real);
  await symlink(real, join(dir, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  const installer = new CodexStatusHooks(join(dir, 'alias', 'hooks.json'), { hooks: { Stop: [] } });
  await assert.rejects(installer.inspect(), /linked/);
});

test('malformed and concurrently edited hook configurations are preserved', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-status-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'hooks.json');
  const installer = new CodexStatusHooks(path, { hooks: { Stop: [] } });
  await writeFile(path, '');
  await assert.rejects(installer.inspect(), /JSON/);
  await writeFile(path, '{');
  await assert.rejects(installer.inspect(), /JSON/);
  await writeFile(path, '{}');
  const before = await installer.inspect();
  await writeFile(path, '{"other":true}');
  await assert.rejects(installer.apply(true, before.digest), /changed/);
  assert.equal(await readFile(path, 'utf8'), '{"other":true}');
});
