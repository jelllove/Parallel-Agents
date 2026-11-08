import assert from 'node:assert/strict';
import test from 'node:test';
import * as activity from '../src/shared/session-activity.ts';

test('provider hooks normalize state without confusing turn completion with process exit', () => {
  assert.equal(activity.activityFromHook('claude', 'UserPromptSubmit', {}), 'running');
  assert.equal(activity.activityFromHook('claude', 'PermissionRequest', {}), 'waiting');
  assert.equal(activity.activityFromHook('claude', 'Stop', {}), 'completed');
  assert.equal(
    activity.activityFromHook('claude', 'SessionEnd', { reason: 'prompt_input_exit' }),
    'unknown',
  );
  assert.equal(activity.activityFromHook('copilot', 'errorOccurred', { recoverable: true }), null);
  assert.equal(
    activity.activityFromHook('copilot', 'errorOccurred', { recoverable: false }),
    'failed',
  );
  assert.equal(
    activity.activityFromHook('codex', 'PostModelRequest', { status: 'failed' }),
    'failed',
  );
  assert.equal(activity.activityFromHook('codex', 'PreModelRequest', {}), 'running');
  assert.equal(activity.activityFromHook('claude', 'Stop', { agent_id: 'child' }), null);
  assert.equal(activity.activityFromHook('copilot', 'agentStop', { agentId: 'child' }), null);
  assert.equal(
    activity.activityFromHook('claude', 'Notification', { notification_type: 'permission_prompt' }),
    'waiting',
  );
  assert.equal(
    activity.activityFromHook('claude', 'Notification', { message: 'permission please' }),
    null,
  );
});

test('activity icons exactly match the requested legend', () => {
  assert.deepEqual(Object.values(activity.ACTIVITY_ICON), ['🏃‍♂️', '❓', '✅', '❔', '❌']);
});
