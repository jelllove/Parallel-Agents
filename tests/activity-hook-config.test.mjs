import assert from 'node:assert/strict';
import test from 'node:test';
import { hookConfiguration, reporterCommand } from '../src/main/activity-hook-config.ts';

test('hook builders observe events without approvals and safely quote platform paths', () => {
  const windows = reporterCommand(
    'C:\\Program Files\\App.exe',
    'C:\\App\\reporter.cjs',
    'Stop',
    'win32',
  );
  assert.match(windows, /^powershell.exe -NoProfile -EncodedCommand [a-zA-Z0-9+/=]+$/);
  const claude = hookConfiguration('claude', '/opt/App', '/opt/reporter.cjs', 'linux');
  assert.ok(claude.hooks.Stop);
  assert.ok(claude.hooks.PermissionRequest);
  assert.doesNotMatch(
    JSON.stringify(claude),
    /permissionDecision|behavior|additionalContext|bypass/,
  );
  const copilot = hookConfiguration('copilot', '/opt/App', '/opt/reporter.cjs', 'linux');
  assert.equal(copilot.version, 1);
  assert.ok(copilot.hooks.agentStop);
  assert.ok(copilot.hooks.permissionRequest);
  assert.ok(
    hookConfiguration('codex', '/opt/App', '/opt/reporter.cjs', 'linux').hooks.PostModelRequest,
  );
});
