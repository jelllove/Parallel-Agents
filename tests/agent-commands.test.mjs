import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resumeCommandFor,
  startCommandFor,
} from '../src/shared/agent-commands.ts';

test('starts a new Copilot session without resume arguments', () => {
  assert.equal(startCommandFor('copilot'), 'copilot');
});

test('resumes the exact Copilot session ID', () => {
  assert.equal(
    resumeCommandFor('copilot', '0cb916db-26aa-40f2-86b5-1ba81b225fd2'),
    'copilot --resume=0cb916db-26aa-40f2-86b5-1ba81b225fd2',
  );
});
