import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyMaintenanceLoop } from '../../scripts/verify-maintenance-loop.mjs';
import {
  captureCandidate,
  sealEvidence,
  verifyEvidence,
} from '../../scripts/evidence/provenance.mjs';

const repository = fileURLToPath(new URL('../..', import.meta.url));

test(
  'real whole-candidate maintenance repair and failed-check rollback remain non-runtime',
  { timeout: 600_000 },
  async (t) => {
    const source = await captureCandidate(repository);
    const result = await verifyMaintenanceLoop({ root: repository });
    t.diagnostic(`Local-fixture receipt: ${result.receiptPath ?? 'not created'}`);
    assert.equal(result.exitCode, 0, JSON.stringify(result.receipt));
    const receipt = result.receipt;
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.scope, 'local-fixture-only');
    assert.equal(receipt.status, 'passed');
    assert.match(receipt.source.commit, /^[a-f0-9]{40,64}$/);
    assert.match(receipt.source.contentSha256, /^[a-f0-9]{64}$/);
    assert.ok(receipt.source.files > 50, 'must validate the whole candidate, not a tiny fixture');
    assert.equal(receipt.positive.status, 'passed');
    assert.equal(receipt.positive.maintenance.repairPasses, 1);
    assert.equal(receipt.positive.maintenance.validation[0].exitCode, 0);
    assert.deepEqual(receipt.positive.changedPaths, [receipt.positive.path]);
    assert.equal(receipt.negative.status, 'passed');
    assert.equal(receipt.negative.unfixableCheck.exitCode, 1);
    assert.equal(receipt.negative.unfixableCheck.reachedDocsCheck, true);
    assert.equal(receipt.negative.maintenance.validation[0].exitCode, 1);
    assert.equal(receipt.negative.maintenance.rollback.status, 'restored');
    assert.equal(receipt.negative.beforeSha256, receipt.negative.restoredSha256);
    assert.deepEqual(receipt.negative.changedPaths, []);
    for (const proof of [
      receipt.positive.protection,
      receipt.negative.protection,
      receipt.checkoutProtection,
    ]) {
      assert.equal(proof.status, 'unchanged');
      assert.equal(proof.beforeSha256, proof.afterSha256);
      assert.ok(proof.files > 0);
    }
    assert.equal(receipt.cleanup.status, 'removed');
    assert.ok(receipt.timing.durationMs < 600_000);
    assert.ok(receipt.artifacts.length >= 4);
    assert.ok(
      receipt.artifacts.every(({ sha256, bytes }) => /^[a-f0-9]{64}$/.test(sha256) && bytes > 0),
    );
    const artifact = relative(repository, result.receiptPath).split(sep).join('/');
    const evidence = `${dirname(artifact).split(sep).join('/')}/evidence.json`;
    await sealEvidence(repository, {
      source,
      origin: 'local-maintenance-fixture',
      artifacts: [artifact],
      output: evidence,
    });
    const verified = await verifyEvidence(repository, evidence);
    assert.equal(verified.sourceMatches, true);
    t.diagnostic(`Source-bound recovery evidence: ${evidence}`);
  },
);
