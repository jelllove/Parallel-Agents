import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);

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
