import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IDLE_AFTER_MS,
  classifyIdleOutput,
  createActivityTracker,
  stripAnsi,
} from '../src/shared/session-activity.ts';

test('stripAnsi removes colour, cursor and OSC title sequences', () => {
  assert.equal(stripAnsi('\x1b[1;32mDone\x1b[0m\x1b]0;title\x07 ok\x1b[2K'), 'Done ok');
});

test('idle output that ends in a prompt or question waits for input', () => {
  for (const tail of [
    'Do you want to proceed?\n❯ 1. Yes\n  2. No',
    'Allow this command? (y/n)',
    'Press Enter to continue',
    'Which file should I edit?',
    '? Select an option ›',
  ]) {
    assert.equal(classifyIdleOutput(tail), 'waiting', tail);
  }
});

test('other idle output means the task finished', () => {
  for (const tail of ['Updated 3 files.\n> ', 'All tests passed.', '']) {
    assert.equal(classifyIdleOutput(tail), 'done', JSON.stringify(tail));
  }
});

test('tracker is running while output streams and settles after the idle delay', () => {
  let now = 0;
  const timers = [];
  const changes = [];
  const tracker = createActivityTracker({
    now: () => now,
    setTimer: (fn, ms) => {
      const t = { fn, at: now + ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      t.cleared = true;
    },
    onChange: (key, state) => changes.push([key, state]),
  });
  const fire = () => {
    for (const t of timers) if (!t.cleared && t.at <= now) ((t.cleared = true), t.fn());
  };

  tracker.input('tab');
  tracker.output('tab', 'Working on it');
  assert.deepEqual(changes, [['tab', 'running']]);
  now += IDLE_AFTER_MS - 1;
  tracker.output('tab', '...still working');
  now += IDLE_AFTER_MS;
  fire();
  assert.deepEqual(changes.at(-1), ['tab', 'done']);

  tracker.output('tab', 'Proceed with edit? (y/n)');
  now += IDLE_AFTER_MS;
  fire();
  assert.deepEqual(changes.at(-1), ['tab', 'waiting']);

  tracker.exit('tab');
  assert.deepEqual(changes.at(-1), ['tab', null]);
});

test('tiny echoes of the user typing do not flip the state to running', () => {
  const changes = [];
  const tracker = createActivityTracker({
    now: () => 0,
    setTimer: () => ({}),
    clearTimer: () => {},
    onChange: (key, state) => changes.push(state),
  });
  tracker.output('tab', 'a');
  assert.deepEqual(changes, []);
  tracker.output('tab', 'A much longer burst of agent output that is clearly not an echo.');
  assert.deepEqual(changes, ['running']);
});

test('project and session rollups prefer waiting over running over done', async () => {
  const { projectActivity, sessionActivity } = await import('../src/shared/activity-rollup.ts');
  const tabProjectId = { a: 'p1', b: 'p1', c: 'p2' };
  const tabSessionId = { a: 's1', b: 's2', c: null };
  assert.equal(projectActivity('p1', tabProjectId, { a: 'done', b: 'running' }), 'running');
  assert.equal(projectActivity('p1', tabProjectId, { a: 'waiting', b: 'running' }), 'waiting');
  assert.equal(projectActivity('p2', tabProjectId, { a: 'running' }), null);
  assert.equal(
    sessionActivity('p1', 's1', tabProjectId, tabSessionId, { a: 'done', b: 'running' }),
    'done',
  );
  assert.equal(sessionActivity('p1', 's9', tabProjectId, tabSessionId, { a: 'done' }), null);
});

test('an agent that exited back to the shell prompt is stopped, not waiting', async () => {
  const { classifyIdleOutput: classify } = await import('../src/shared/session-activity.ts');
  for (const tail of [
    'Do you want to continue?\nGoodbye!\nC:\\XQQ\\AzureNotebooks>',
    'Allow this command? (y/n)\n\nPS C:\\XQQ\\repo> ',
    'Which file?\nuser@host:~/repo$ ',
  ]) {
    assert.equal(classify(tail), 'stopped', JSON.stringify(tail));
  }
});

test('questions earlier in the output do not make a finished answer look like waiting', async () => {
  const { classifyIdleOutput: classify } = await import('../src/shared/session-activity.ts');
  const tail = [
    'Why did the build fail?',
    'The permission check was missing, so I added it.',
    'Updated src/app.ts and ran the tests.',
    'All 42 tests passed.',
  ].join('\n');
  assert.equal(classify(tail), 'done');
});

test('tracker clears the badge when the agent returns to the shell prompt', () => {
  let now = 0;
  const timers = [];
  const changes = [];
  const tracker = createActivityTracker({
    now: () => now,
    setTimer: (fn, ms) => {
      const t = { fn, at: now + ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      t.cleared = true;
    },
    onChange: (key, state) => changes.push(state),
  });
  tracker.input('tab');
  tracker.output('tab', 'Proceed? (y/n)\nExiting.\r\nC:\\repo>');
  now += IDLE_AFTER_MS;
  for (const t of timers) if (!t.cleared && t.at <= now) ((t.cleared = true), t.fn());
  assert.deepEqual(changes, ['running', null]);
});
