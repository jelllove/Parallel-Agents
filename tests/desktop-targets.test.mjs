import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopTarget, providerShim } from '../scripts/desktop-targets.mjs';

test('native smoke resolves actual app.asar layouts for each desktop target', () => {
  assert.deepEqual(desktopTarget('win32', 'x64').asarSegments, [
    'win-unpacked',
    'resources',
    'app.asar',
  ]);
  assert.deepEqual(desktopTarget('linux', 'x64').asarSegments, [
    'linux-unpacked',
    'resources',
    'app.asar',
  ]);
  assert.deepEqual(desktopTarget('darwin', 'arm64').asarSegments, [
    'mac-arm64',
    'Parallel Agents.app',
    'Contents',
    'Resources',
    'app.asar',
  ]);
  assert.throws(() => desktopTarget('darwin', 'x64'), /Unsupported desktop target/);
  assert.throws(() => desktopTarget('linux', 'arm64'), /Unsupported desktop target/);
});

test('provider shims are inert executable POSIX scripts or Windows cmd files', () => {
  assert.deepEqual(providerShim('claude', 'win32'), {
    name: 'claude.cmd',
    content: '@echo off\r\necho SMOKE_AGENT\r\n',
    mode: 0o644,
  });
  for (const platform of ['darwin', 'linux']) {
    assert.deepEqual(providerShim('claude', platform), {
      name: 'claude',
      content: '#!/bin/sh\nprintf "SMOKE_AGENT\\n"\n',
      mode: 0o755,
    });
  }
  assert.throws(() => providerShim('../escape', 'linux'), /Invalid provider/);
});
