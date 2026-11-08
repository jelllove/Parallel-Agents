import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActivityBridge } from '../src/main/activity-bridge.ts';

function report(env, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['resources/activity-reporter.cjs', 'Stop'], {
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

test('reporter strips sensitive payload, sends activity and always exits silently', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'activity-reporter-'));
  const bridge = new ActivityBridge(dir);
  await bridge.start();
  t.after(async () => {
    await bridge.close();
    await rm(dir, { recursive: true, force: true });
  });
  const launch = bridge.register('tab', 'claude', 'one');
  const result = await report(
    { PA_ACTIVITY_ENDPOINT: bridge.endpoint, PA_ACTIVITY_TOKEN: launch.token },
    JSON.stringify({
      session_id: 'one',
      prompt: 'private',
      transcript_path: '/secret',
      last_assistant_message: 'private',
    }),
  );
  assert.deepEqual(result, { code: 0, stdout: '', stderr: '' });
  assert.equal(bridge.snapshot().records[0].state, 'completed');
  assert.doesNotMatch(JSON.stringify(bridge.snapshot()), /private|secret/);
  assert.deepEqual(
    await report({ PA_ACTIVITY_TOKEN: '', PA_ACTIVITY_ENDPOINT: '' }, 'malformed'),
    result,
  );
  assert.deepEqual(
    await report({ PA_ACTIVITY_TOKEN: launch.token, PA_ACTIVITY_ENDPOINT: bridge.endpoint }, '{'),
    result,
  );
  assert.deepEqual(
    await report(
      { PA_ACTIVITY_TOKEN: launch.token, PA_ACTIVITY_ENDPOINT: bridge.endpoint },
      'x'.repeat(1024 * 1024 + 1),
    ),
    result,
  );
  assert.deepEqual(
    await report(
      { PA_ACTIVITY_TOKEN: launch.token, PA_ACTIVITY_ENDPOINT: `${bridge.endpoint}-missing` },
      '{}',
    ),
    result,
  );
});
