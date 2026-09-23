import assert from 'node:assert/strict';
import test from 'node:test';

import {
  removeProjectsFromSnapshot,
  stabilizeCopilotProjects,
  validateMissingProjectIds,
} from '../src/main/project-policies.ts';

const project = (id, exists = false, agent = 'copilot') => ({
  id,
  agent,
  dirName: id.slice(id.indexOf(':') + 1),
  realPath: `C:\\work\\${id}`,
  displayName: id,
  exists,
  pinned: false,
  hidden: false,
  sessionCount: 1,
  lastActivity: 1,
});

test('keeps the previous Copilot snapshot when every candidate fails', () => {
  const previous = [project('copilot:C:\\work\\alpha')];
  const result = stabilizeCopilotProjects(previous, {
    projects: [],
    valid: true,
    candidateCount: 3,
    parsedCount: 0,
  });

  assert.deepEqual(result, previous);
});

test('accepts a legitimate empty Copilot inventory', () => {
  const result = stabilizeCopilotProjects([project('copilot:old')], {
    projects: [],
    valid: true,
    candidateCount: 0,
    parsedCount: 0,
  });

  assert.deepEqual(result, []);
});

test('accepts valid projects while ignoring malformed candidates', () => {
  const current = [project('copilot:C:\\work\\beta')];
  const result = stabilizeCopilotProjects([], {
    projects: current,
    valid: true,
    candidateCount: 2,
    parsedCount: 1,
  });

  assert.deepEqual(result, current);
});

test('keeps the previous Copilot snapshot when the session root is temporarily unreadable', () => {
  const previous = [project('copilot:C:\\work\\alpha')];
  const result = stabilizeCopilotProjects(previous, {
    projects: [],
    valid: false,
    candidateCount: 0,
    parsedCount: 0,
  });

  assert.deepEqual(result, previous);
});

test('removes deleted project IDs from a retained snapshot', () => {
  const a = project('copilot:C:\\work\\alpha');
  const b = project('copilot:C:\\work\\beta');

  assert.deepEqual(removeProjectsFromSnapshot([a, b], [a.id]), [b]);
});

test('validates a unique set of missing deletable projects', () => {
  const a = project('copilot:C:\\work\\gone-a');
  const b = project('claude:C--work-gone-b', false, 'claude');
  const c = project('codex:C:\\work\\gone-c', false, 'codex');

  assert.deepEqual(validateMissingProjectIds([a, b, c], [a.id, b.id, c.id, a.id]), [a, b, c]);
});

test('rejects bulk deletion when a working directory still exists', () => {
  const active = project('copilot:C:\\work\\active', true);

  assert.throws(() => validateMissingProjectIds([active], [active.id]), /not missing/);
});

test('rejects unknown and unsupported projects', () => {
  const aider = project('aider:C:\\work\\gone', false, 'aider');

  assert.throws(() => validateMissingProjectIds([aider], [aider.id]), /not supported/);
  assert.throws(() => validateMissingProjectIds([], ['copilot:unknown']), /Unknown project/);
});

test('mergeWorktreeProjects folds linked worktrees into the main repository project per agent', async () => {
  const { mergeWorktreeProjects } = await import('../src/main/project-policies.ts');
  const make = (id, agent, realPath, extra = {}) => ({
    ...project(id, true, agent),
    realPath,
    sessionCount: 1,
    lastActivity: 10,
    createdAt: 5,
    ...extra,
  });
  const main = make('claude:main', 'claude', 'C:/repo', { lastActivity: 10, createdAt: 3 });
  const wt = make('claude:wt', 'claude', 'C:/repo.worktree/a', {
    sessionCount: 2,
    lastActivity: 30,
  });
  const other = make('claude:other', 'claude', 'C:/other');
  const copilotWt = make('copilot:wt', 'copilot', 'C:/repo.worktree/a');
  const missing = { ...make('claude:gone', 'claude', 'C:/repo.worktree/gone'), exists: false };
  const ids = {
    'C:/repo': { commonDir: 'c:/repo/.git', mainPath: 'C:/repo' },
    'C:/repo.worktree/a': { commonDir: 'c:/repo/.git', mainPath: 'C:/repo' },
  };
  const { projects, members } = mergeWorktreeProjects(
    [wt, main, other, copilotWt, missing],
    (p) => ids[p.realPath] ?? null,
  );
  const merged = projects.find((p) => p.id === 'claude:main');
  assert.equal(merged.sessionCount, 3);
  assert.equal(merged.lastActivity, 30);
  assert.equal(merged.createdAt, 3);
  assert.equal(merged.displayName, 'repo');
  assert.deepEqual(merged.worktrees, [{ realPath: 'C:/repo.worktree/a', exists: true }]);
  assert.deepEqual(projects.map((p) => p.id).sort(), [
    'claude:gone',
    'claude:main',
    'claude:other',
    'copilot:wt',
  ]);
  assert.deepEqual(members.get('claude:main'), [
    { id: 'claude:main', realPath: 'C:/repo' },
    { id: 'claude:wt', realPath: 'C:/repo.worktree/a' },
  ]);
  assert.equal(members.has('copilot:wt'), false);
});

test('a worktree group without the main folder keeps its first member as the entry', async () => {
  const { mergeWorktreeProjects } = await import('../src/main/project-policies.ts');
  const a = { ...project('codex:a', true, 'codex'), realPath: 'C:/r.worktree/a', createdAt: null };
  const b = { ...project('codex:b', true, 'codex'), realPath: 'C:/r.worktree/b', createdAt: null };
  const identity = { commonDir: 'c:/r/.git', mainPath: 'C:/r' };
  const { projects, members } = mergeWorktreeProjects([a, b], () => identity);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].id, 'codex:a');
  assert.equal(projects[0].displayName, 'r');
  assert.equal(members.get('codex:a').length, 2);
});
