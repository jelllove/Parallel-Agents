import assert from 'node:assert/strict';
import { link, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { runTests } from '../scripts/test-ci.mjs';

async function fixture(t, passing = true) {
  const root = await mkdtemp(join(tmpdir(), 'parallel-agents-test-report-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'tests'));
  await writeFile(
    join(root, 'tests', 'sample.test.mjs'),
    `
import assert from 'node:assert/strict';
import test from 'node:test';
test('fixture', () => assert.equal(${passing}, true));
`,
  );
  return root;
}

test('test reporters never follow old predictable output-file links', async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await mkdir(join(root, 'reports'));
  await writeFile(join(outside, 'junit.xml'), 'preserve XML');
  await writeFile(join(outside, 'coverage.lcov'), 'preserve LCOV');
  await link(join(outside, 'junit.xml'), join(root, 'reports', 'tests.xml'));
  await link(join(outside, 'coverage.lcov'), join(root, 'reports', 'coverage.lcov'));
  const result = await runTests(root);
  assert.equal(result.exitCode, 0);
  assert.match(relative(await realpath(join(root, 'reports')), result.junitPath), /^tests[\\/]/);
  assert.equal(await readFile(join(outside, 'junit.xml'), 'utf8'), 'preserve XML');
  assert.equal(await readFile(join(outside, 'coverage.lcov'), 'utf8'), 'preserve LCOV');
  assert.match(await readFile(result.junitPath, 'utf8'), /testsuite/);
  const receipt = JSON.parse(await readFile(result.receiptPath, 'utf8'));
  assert.ok(
    receipt.command?.includes('--test-concurrency=4'),
    'CI must bound its Git-heavy test workers',
  );
});

test('failing tests keep a failing exit code and retain their own diagnostics', async (t) => {
  const root = await fixture(t, false);
  const result = await runTests(root);
  assert.notEqual(result.exitCode, 0, result.stdout + result.stderr);
  assert.match(await readFile(result.junitPath, 'utf8'), /failure/);
  assert.equal(JSON.parse(await readFile(result.receiptPath, 'utf8')).exitCode, result.exitCode);
});

test('each invocation creates distinct reporter files instead of overwriting earlier runs', async (t) => {
  const root = await fixture(t);
  const first = await runTests(root);
  const before = await readFile(first.junitPath, 'utf8');
  const second = await runTests(root);
  assert.notEqual(first.junitPath, second.junitPath);
  assert.equal(await readFile(first.junitPath, 'utf8'), before);
});

test('test reporter run directories cannot follow links outside the checkout', async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await mkdir(join(root, 'reports'));
  await symlink(
    outside,
    join(root, 'reports', 'tests'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(runTests(root), /link/i);
});
