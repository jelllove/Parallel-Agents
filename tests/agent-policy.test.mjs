import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('Claude project configuration only narrows or asks for permissions', async () => {
  const settings = JSON.parse(await readFile(resolve(root, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(Object.keys(settings).sort(), ['$schema', 'permissions']);
  assert.deepEqual(Object.keys(settings.permissions).sort(), ['ask', 'deny']);
  assert.ok(settings.permissions.deny.includes('Read(./.env)'));
  for (const tool of ['Bash', 'PowerShell']) {
    assert.ok(settings.permissions.deny.includes(`${tool}(git reset --hard*)`));
    assert.ok(settings.permissions.ask.includes(`${tool}(git push *)`));
    assert.ok(settings.permissions.ask.includes(`${tool}(npm publish *)`));
  }
  assert.equal(settings.model, undefined);
  assert.equal(settings.hooks, undefined);
});

test('maintenance review remains manually invoked and read-only', async () => {
  const profile = await readFile(
    resolve(root, '.github', 'agents', 'maintenance-review.agent.md'),
    'utf8',
  );
  assert.match(profile, /^disable-model-invocation: true$/m);
  const tools = profile.match(/^tools:\s*\[([^\]\r\n]*)\]\s*$/m);
  assert.ok(tools, 'Expected an explicit flow-style tool allowlist');
  const names = tools[1].split(',').map((name) => name.trim().replace(/^(['"])(.*)\1$/, '$2'));
  assert.deepEqual(names.sort(), ['read', 'search']);
});

test('local agent settings stay ignored while the shared project policy is versionable', async () => {
  const ignored = await readFile(resolve(root, '.gitignore'), 'utf8');
  assert.match(ignored, /^\.claude\/\*$/m);
  assert.match(ignored, /^!\.claude\/settings\.json$/m);
});
