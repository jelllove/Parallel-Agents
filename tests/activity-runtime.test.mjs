import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActivityRuntime } from '../src/main/activity-runtime.ts';

test('managed launch hooks are temporary, preserve existing config and expose only private environment', async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'activity-runtime-')));
  const runtime = new ActivityRuntime({
    directory,
    executable: process.execPath,
    reporter: join(process.cwd(), 'resources/activity-reporter.cjs'),
    codexHooksPath: join(directory, 'codex/hooks.json'),
    platform: process.platform,
    supports: async () => true,
  });
  t.after(async () => {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  });
  const launch = await runtime.prepare('claude', 'tab::agent', 'one', 'claude --resume one');
  assert.match(launch.command, /--settings/);
  assert.ok(launch.environment.PA_ACTIVITY_TOKEN);
  assert.equal(launch.environment.ELECTRON_RUN_AS_NODE, undefined);
  assert.doesNotMatch(launch.command, /bypass|setting-sources/);
  assert.ok(JSON.parse(await readFile(launch.configPath, 'utf8')).hooks.Stop);
  launch.end('unknown');
  assert.equal(runtime.snapshot().records[0].state, 'unknown');
  const copilot = await runtime.prepare('copilot', 'other::agent', 'two', 'copilot --resume=two');
  assert.match(copilot.command, /--plugin-dir/);
  assert.equal(JSON.parse(await readFile(copilot.configPath, 'utf8')).version, 1);
  const codex = await runtime.prepare('codex', 'codex::agent', 'three', 'codex resume three');
  assert.equal(codex.command, 'codex resume three');
  assert.deepEqual(codex.environment, {});
});
