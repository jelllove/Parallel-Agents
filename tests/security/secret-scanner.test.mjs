import '../helpers/isolated-git.mjs';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { scanRepository } from '../../scripts/scan-secrets.mjs';

const execFileAsync = promisify(execFile);

test('pinned scanner detects generated fixture credentials without disclosing them', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'parallel-agents-scanner-contract-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  await execFileAsync('git', ['-C', root, 'init', '--initial-branch=main']);
  await writeFile(join(root, '.gitignore'), 'reports/\nprivate.env\n');
  await writeFile(join(root, '.gitleaks.toml'), '[extend]\nuseDefault = true\n');
  const generated = ['ghp', randomBytes(18).toString('hex')].join('_');
  await writeFile(join(root, 'fixture.js'), `export const token = "${generated}";\n`);
  const findings = await scanRepository(root);
  assert.equal(findings.status, 'findings');
  const sarif = await readFile(findings.sarifPath, 'utf8');
  assert.equal(sarif.includes(generated), false);
  assert.ok(JSON.parse(sarif).runs.some((run) => run.results.length > 0));

  await writeFile(join(root, 'fixture.js'), 'export const enabled = true;\n');
  await writeFile(join(root, 'private.env'), generated);
  const clean = await scanRepository(root);
  assert.equal(clean.status, 'clean');
  assert.notEqual(clean.receiptPath, findings.receiptPath);
  assert.equal((await readFile(findings.sarifPath, 'utf8')).includes(generated), false);
});
