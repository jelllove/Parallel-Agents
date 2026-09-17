import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import {
  artifactPath,
  assertMatches,
  decodeText,
  readSafeFile,
  replaceMatching,
  reserveArtifact,
  safePath,
  safeRoot,
} from './filesystem.mjs';
import { formatFiles, makePatch } from './formatting.mjs';
import {
  dirtyStatus,
  generatedPaths,
  ignoredPaths,
  inventory,
  protectedFingerprint,
  requireRepositoryRoot,
} from './inventory.mjs';
import {
  candidatePath,
  fail,
  generatedHeader,
  includedByPolicy,
  LIMITS,
  limitsFor,
  MaintenanceError,
  parseFormatOptions,
  parsePolicy,
} from './policy.mjs';
import { runNpmCheck } from './process.mjs';

const inputPaths = [
  '.gitignore',
  '.prettierignore',
  '.prettierrc.json',
  '.github/maintenance.json',
];
const sha = (content) => createHash('sha256').update(content).digest('hex');

function initialReceipt(apply, startedAt) {
  return {
    schemaVersion: 1,
    tool: 'non-runtime-maintenance',
    mode: apply ? 'apply' : 'check',
    status: 'failed',
    limits: { ...LIMITS },
    inventory: {
      visiblePaths: 0,
      excludedPaths: 0,
      candidates: 0,
      candidateBytes: 0,
      generatedPaths: [],
    },
    formatter: { name: 'prettier', version: null, embeddedLanguageFormatting: 'off' },
    repairPasses: 0,
    changes: [],
    validation: [],
    rollback: { status: 'not-needed', restoredPaths: [], conflictPaths: [] },
    protection: {
      policy: 'non-runtime-formatting-v1',
      writtenPaths: [],
      fingerprintScope:
        'Git-visible, nonignored, policy-readable source/resource/script/test and root build inputs',
      beforeSha256: null,
      afterSha256: null,
      filesBefore: 0,
      filesAfter: 0,
    },
    artifacts: { output: null, patch: null },
    errors: [],
    timing: {
      startedAt,
      finishedAt: null,
      durationMs: 0,
      scope:
        'inspection, formatting, validation and rollback; excludes final receipt serialization/output',
    },
  };
}

function recordError(receipt, error) {
  receipt.errors.push(
    error instanceof MaintenanceError
      ? { code: error.code, message: error.message, ...(error.path ? { path: error.path } : {}) }
      : {
          code: 'operation-failed',
          message:
            'A filesystem or maintenance operation failed; no external diagnostic content is included.',
        },
  );
}

export function invalidArgumentsResult(apply) {
  const started = performance.now();
  const receipt = initialReceipt(apply, new Date().toISOString());
  recordError(
    receipt,
    new MaintenanceError('invalid-arguments', 'Invalid command arguments; use --help.'),
  );
  receipt.timing.finishedAt = new Date().toISOString();
  receipt.timing.durationMs = Math.round(performance.now() - started);
  return { receipt, exitCode: 2 };
}

async function checkInputs(root, inputs, limits) {
  for (const [path, snapshot] of inputs) {
    if (snapshot) await assertMatches(root, snapshot, limits.maxConfigBytes);
    else if ((await safePath(root, path, { missing: true })).stat) {
      fail('concurrent-edit', 'A maintenance input appeared during the run.', path);
    }
  }
}

async function validateOnce(root, limits, validate) {
  const started = performance.now();
  let timer;
  try {
    const result = validate
      ? await Promise.race([
          Promise.resolve().then(() => validate({ root, limits })),
          new Promise((resolve) => {
            timer = setTimeout(
              () => resolve({ status: 'timed-out', exitCode: null }),
              limits.validationTimeoutMs,
            );
          }),
        ])
      : await runNpmCheck(root, limits);
    const valid =
      result &&
      ['passed', 'failed', 'timed-out', 'output-limit', 'spawn-error', 'input-error'].includes(
        result.status,
      ) &&
      (Number.isInteger(result.exitCode) || result.exitCode === null) &&
      !(result.status === 'passed' && (result.exitCode !== 0 || result.terminationFailed));
    return {
      command: ['npm', 'run', 'check'],
      status: valid ? result.status : 'invalid-result',
      exitCode: valid ? result.exitCode : null,
      signal: valid && typeof result.signal === 'string' ? result.signal : null,
      outputBytes: Number.isSafeInteger(result?.outputBytes) ? result.outputBytes : 0,
      terminationFailed: result?.terminationFailed === true,
      durationMs: Math.round(performance.now() - started),
    };
  } catch {
    return {
      command: ['npm', 'run', 'check'],
      status: 'runner-error',
      exitCode: null,
      signal: null,
      outputBytes: 0,
      terminationFailed: false,
      durationMs: Math.round(performance.now() - started),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function rollback(root, writes, receipt) {
  if (writes.size === 0) return;
  for (const change of [...writes.values()].reverse()) {
    try {
      await replaceMatching(root, change.owned, change.before.content);
      receipt.rollback.restoredPaths.push(change.path);
    } catch {
      receipt.rollback.conflictPaths.push(change.path);
    }
  }
  receipt.rollback.restoredPaths.sort();
  receipt.rollback.conflictPaths.sort();
  receipt.rollback.status = receipt.rollback.conflictPaths.length ? 'conflict' : 'restored';
}

/**
 * Runs one maintenance transaction. The second argument is an external validation/concurrency
 * boundary for isolated fixtures, not a CLI option or a configurable command/plugin mechanism.
 */
export async function runMaintenance(options = {}, { validate, beforeWrite } = {}) {
  const started = performance.now();
  const receipt = initialReceipt(options.apply === true, new Date().toISOString());
  const writes = new Map();
  const artifacts = new Map();
  const inputs = new Map();
  let root;
  let limits;
  let policy;
  let visible;
  let failure = false;
  const finishTiming = () => {
    receipt.timing.finishedAt = new Date().toISOString();
    receipt.timing.durationMs = Math.round(performance.now() - started);
  };
  const verifyPatch = async () => {
    const patch = artifacts.get('patch');
    if (!patch || receipt.artifacts.patch.status !== 'written') return;
    try {
      await assertMatches(root, patch, patch.content.length);
    } catch {
      receipt.artifacts.patch.status = 'conflict';
      fail(
        'artifact-conflict',
        'The proposed patch was changed or replaced by another writer.',
        patch.path,
      );
    }
  };
  const publishReport = async () => {
    finishTiming();
    const report = artifacts.get('output');
    if (!report) return;
    receipt.artifacts.output.status = 'written';
    const content = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    const final = await replaceMatching(root, report, content, (snapshot) => {
      artifacts.set('output', snapshot);
    });
    artifacts.set('output', final);
  };
  try {
    if (
      Object.keys(options).some(
        (key) => !['root', 'apply', 'output', 'patch', 'limits'].includes(key),
      ) ||
      (options.apply !== undefined && typeof options.apply !== 'boolean')
    ) {
      fail('invalid-options', 'Unsupported maintenance options.');
    }
    limits = limitsFor(options.limits);
    receipt.limits = limits;
    root = await safeRoot(options.root ?? process.cwd());
    await requireRepositoryRoot(root, limits);
    const targets = [];
    for (const [kind, extension] of [
      ['output', '.json'],
      ['patch', '.patch'],
    ]) {
      if (options[kind] === undefined) continue;
      const path = artifactPath(options[kind], extension);
      if ((await safePath(root, path, { missing: true })).stat) {
        fail('output-exists', 'An artifact target already exists; choose a new path.', path);
      }
      if (!(await ignoredPaths(root, [path], limits)).has(path)) {
        fail(
          'unsafe-output',
          'Artifact targets must be Git-ignored reports/maintenance files.',
          path,
        );
      }
      targets.push({ kind, path });
    }
    for (const { kind, path } of targets) {
      artifacts.set(kind, await reserveArtifact(root, path));
      receipt.artifacts[kind] = { path, status: 'reserved' };
    }
    if (options.apply && (await dirtyStatus(root, limits)).length) {
      fail(
        'dirty-worktree',
        'Apply requires a clean index and working tree, including untracked files; no edits were reset or stashed.',
      );
    }
    for (const path of inputPaths) {
      inputs.set(path, await readSafeFile(root, path, limits.maxConfigBytes, { optional: true }));
    }
    const policyInput = inputs.get('.github/maintenance.json');
    policy = policyInput
      ? parsePolicy(decodeText(policyInput.content, policyInput.path))
      : { include: ['**/*'], exclude: [] };
    const formatInput = inputs.get('.prettierrc.json');
    const formatOptions = parseFormatOptions(
      formatInput ? decodeText(formatInput.content, formatInput.path) : undefined,
    );
    visible = await inventory(root, limits, policy, Boolean(inputs.get('.prettierignore')));
    receipt.inventory.visiblePaths = visible.count;
    receipt.inventory.excludedPaths = visible.excludedCount;
    const candidates = [];
    const candidatePaths = visible.active.filter((path) => includedByPolicy(path, policy));
    if (candidatePaths.length > limits.maxCandidates) {
      fail('limit-exceeded', 'The candidate count budget was exceeded.');
    }
    const generated = await generatedPaths(root, candidatePaths, limits);
    for (const path of candidatePaths) {
      if (generated.has(path)) {
        receipt.inventory.generatedPaths.push(path);
        continue;
      }
      const snapshot = await readSafeFile(root, path, limits.maxFileBytes, { optional: true });
      if (!snapshot) continue;
      receipt.inventory.candidateBytes += snapshot.content.length;
      if (receipt.inventory.candidateBytes > limits.maxCandidateBytes) {
        fail('limit-exceeded', 'The candidate total byte budget was exceeded.');
      }
      if (generatedHeader(decodeText(snapshot.content, path))) {
        receipt.inventory.generatedPaths.push(path);
        continue;
      }
      candidates.push(snapshot);
      receipt.inventory.candidates = candidates.length;
    }
    const before = await protectedFingerprint(root, visible.active, limits);
    receipt.protection.beforeSha256 = before.sha256;
    receipt.protection.filesBefore = before.files;
    const result = await formatFiles(candidates, formatOptions, limits.formattingTimeoutMs);
    receipt.formatter.version = result.version;
    const changes = [];
    let formattedBytes = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      const beforeFile = candidates[index];
      const formattedFile = result.formatted[index];
      if (formattedFile?.path !== beforeFile.path) {
        fail('format-failed', 'The formatter returned an incomplete or mismatched queue.');
      }
      const after = Buffer.from(formattedFile.text);
      formattedBytes += after.length;
      if (after.length > limits.maxFileBytes * 2 || formattedBytes > limits.maxCandidateBytes * 2) {
        fail(
          'limit-exceeded',
          'Formatted output exceeds the bounded output budget.',
          beforeFile.path,
        );
      }
      if (!beforeFile.content.equals(after)) {
        changes.push({ path: beforeFile.path, before: beforeFile, after });
        receipt.changes.push({
          path: beforeFile.path,
          beforeSha256: sha(beforeFile.content),
          afterSha256: sha(after),
          beforeBytes: beforeFile.content.length,
          afterBytes: after.length,
        });
      }
    }
    await checkInputs(root, inputs, limits);
    for (const candidate of candidates) {
      await assertMatches(root, candidate, limits.maxFileBytes);
    }
    const patch = artifacts.get('patch');
    if (patch) {
      await replaceMatching(root, patch, Buffer.from(makePatch(changes)), (snapshot) => {
        artifacts.set('patch', snapshot);
        receipt.artifacts.patch.status = 'writing';
      });
      receipt.artifacts.patch.status = 'written';
    }
    if (options.apply && changes.length > 0) {
      if (beforeWrite) await beforeWrite({ root });
      if ((await dirtyStatus(root, limits)).length) {
        fail('concurrent-edit', 'The working tree changed before the repair pass.');
      }
      await checkInputs(root, inputs, limits);
      receipt.repairPasses = 1;
      for (const change of changes) {
        if (!candidatePath(change.path))
          fail('protected-path', 'The hard write policy rejected a path.');
        await replaceMatching(root, change.before, change.after, (owned) => {
          writes.set(change.path, { ...change, owned });
          receipt.protection.writtenPaths = [...writes.keys()].sort();
        });
      }
      const validation = await validateOnce(root, limits, validate);
      receipt.validation.push(validation);
      if (validation.status !== 'passed' || validation.exitCode !== 0) {
        fail(
          'validation-failed',
          'npm run check did not pass; only still-matching maintenance writes will be restored.',
        );
      }
      for (const change of writes.values()) {
        await assertMatches(root, change.owned, limits.maxFileBytes * 2);
      }
    }
    await checkInputs(root, inputs, limits);
    const afterVisible = await inventory(
      root,
      limits,
      policy,
      Boolean(inputs.get('.prettierignore')),
    );
    const after = await protectedFingerprint(root, afterVisible.active, limits);
    receipt.protection.afterSha256 = after.sha256;
    receipt.protection.filesAfter = after.files;
    if (before.sha256 !== after.sha256) {
      fail(
        'protected-content-changed',
        'Protected inputs changed during maintenance or validation; these third-party changes will not be overwritten.',
      );
    }
    receipt.status = changes.length ? (options.apply ? 'applied' : 'changes-needed') : 'clean';
    await verifyPatch();
    await publishReport();
  } catch (error) {
    failure = true;
    recordError(receipt, error);
    receipt.status =
      error instanceof MaintenanceError && error.code === 'dirty-worktree' ? 'refused' : 'failed';
    if (root) await rollback(root, writes, receipt);
    if (receipt.rollback.status === 'conflict') receipt.status = 'rollback-conflict';
    if (receipt.artifacts.patch?.status === 'writing') receipt.artifacts.patch.status = 'failed';
    try {
      await verifyPatch();
    } catch (patchError) {
      recordError(receipt, patchError);
    }
    if (root && policy && receipt.protection.beforeSha256 && !receipt.protection.afterSha256) {
      try {
        const current = await inventory(
          root,
          limits,
          policy,
          Boolean(inputs.get('.prettierignore')),
        );
        const fingerprint = await protectedFingerprint(root, current.active, limits);
        receipt.protection.afterSha256 = fingerprint.sha256;
        receipt.protection.filesAfter = fingerprint.files;
      } catch {
        recordError(
          receipt,
          new MaintenanceError(
            'protection-unverified',
            'The final protected-input fingerprint could not be obtained.',
          ),
        );
      }
    }
    try {
      await publishReport();
    } catch (reportError) {
      receipt.artifacts.output.status = 'failed';
      recordError(receipt, reportError);
      finishTiming();
    }
  }
  return { receipt, exitCode: failure ? 2 : receipt.status === 'changes-needed' ? 1 : 0 };
}
