import assert from 'node:assert/strict';
import test from 'node:test';
import { createGitStatusReads } from '../src/renderer/store/git-status-reads.ts';
test('Git watcher bursts share one in-flight status and publish the final trailing snapshot', async () => {
  let calls = 0;
  const first = Promise.withResolvers();
  const read = createGitStatusReads(async () => {
    calls++;
    return calls === 1 ? first.promise : 'latest';
  });
  const a = read('/repo'),
    b = read('/repo'),
    c = read('/repo');
  assert.equal(calls, 1);
  first.resolve('old');
  assert.deepEqual(await Promise.all([a, b, c]), ['latest', 'latest', 'latest']);
  assert.equal(calls, 2);
});
