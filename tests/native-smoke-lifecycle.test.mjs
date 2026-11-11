import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);

test('native deletion verification preserves exact unselected identities while histories arrive', () => {
  const { assertSessionPreservation } = require('./helpers/session-preservation.cjs');
  const kept = { agent: 'claude', id: 'keep', title: 'Old name' };
  const removed = { agent: 'claude', id: 'delete' };
  const collision = { agent: 'codex', id: 'keep' };
  const after = [{ ...kept, title: 'New name' }, collision, { agent: 'claude', id: 'new' }];
  assert.doesNotThrow(() =>
    assertSessionPreservation([kept, removed, collision], after, [removed]),
  );
  assert.throws(
    () => assertSessionPreservation([kept, removed, collision], [kept], [removed]),
    /Unselected native history disappeared: codex:keep/,
  );
  assert.throws(
    () => assertSessionPreservation([kept, removed], [kept, removed], [removed]),
    /Selected native history remains/,
  );
});

test('native smoke teardown waits for actual PTY exits including previously killed terminals', async () => {
  const { trackNativePtys } = require('./helpers/native-pty-lifecycle.cjs');
  const tracker = trackNativePtys();
  let exit;
  tracker.track({
    onExit(callback) {
      exit = callback;
      return { dispose() {} };
    },
  });
  let settled = false;
  const draining = tracker.drain(1000).then(() => {
    settled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  exit({ exitCode: 0 });
  await draining;
  assert.equal(settled, true);
});

test('native smoke animation waits are not suspended when its fixture window is occluded', async () => {
  const source = await readFile(new URL('./e2e/electron.e2e.cjs', import.meta.url), 'utf8');
  assert.match(source, /win\.webContents\.setBackgroundThrottling\(false\)/);
  assert.ok(
    source.indexOf('setBackgroundThrottling(false)') <
      source.indexOf("win.webContents.once('did-finish-load'"),
  );
});

test('native teardown timeout fails explicitly rather than fabricating completed shutdown', async () => {
  const { trackNativePtys } = require('./helpers/native-pty-lifecycle.cjs');
  const tracker = trackNativePtys();
  tracker.track({
    onExit() {
      return { dispose() {} };
    },
  });
  await assert.rejects(tracker.drain(20), /Native PTY shutdown did not finish/);
});
