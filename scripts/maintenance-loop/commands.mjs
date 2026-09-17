import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { fail } from '../maintenance/policy.mjs';
import { runOwnedProcess, validationEnvironment } from '../maintenance/process.mjs';
import { errorRecord, LOOP_LIMITS, sha256 } from './contract.mjs';
import { parseCheckProgress } from './progress.mjs';

export function processEvidence(command, cwd, result) {
  return {
    command,
    cwd,
    status: result.status,
    exitCode: result.exitCode,
    signal: result.signal,
    pid: result.pid,
    durationMs: result.durationMs,
    outputBytes: result.outputBytes,
    stdoutSha256: sha256(result.stdout ?? Buffer.alloc(0)),
    terminationFailed: result.terminationFailed,
  };
}

export function createCommands({
  env = validationEnvironment(),
  maxCommands = LOOP_LIMITS.maxCommands,
  onStep,
} = {}) {
  if (
    !Number.isSafeInteger(maxCommands) ||
    maxCommands < 1 ||
    maxCommands > LOOP_LIMITS.maxCommands
  ) {
    fail('invalid-options', 'Command budgets may only lower the fixed verifier limit.');
  }
  const steps = [];
  const deadline = performance.now() + LOOP_LIMITS.totalTimeoutMs;
  let running = false;
  const run = async (
    name,
    executable,
    args,
    { cwd, accepted = [0], input, timeoutMs = LOOP_LIMITS.gitTimeoutMs, progressCatalogue } = {},
  ) => {
    const remaining = Math.floor(deadline - performance.now());
    if (running || steps.length >= maxCommands || remaining <= 0) {
      fail('limit-exceeded', 'The sequential command or total runtime budget was exhausted.');
    }
    running = true;
    try {
      const effectiveTimeoutMs = Math.min(timeoutMs, remaining);
      const result = await runOwnedProcess(executable, args, {
        cwd,
        env,
        input,
        capture: true,
        timeoutMs: effectiveTimeoutMs,
        maxOutputBytes: LOOP_LIMITS.maxOutputBytes,
      });
      const step = {
        name,
        ...processEvidence([executable, ...args], cwd, result),
        timeoutMs: effectiveTimeoutMs,
      };
      steps.push(step);
      let progressError;
      if (progressCatalogue !== undefined) {
        try {
          step.progress = parseCheckProgress(result.stdout, progressCatalogue);
        } catch (error) {
          progressError = error;
          step.progressError = errorRecord(error);
        }
      }
      if (onStep) await onStep(step, steps.length);
      if (
        !['passed', 'failed'].includes(result.status) ||
        !accepted.includes(result.exitCode) ||
        result.terminationFailed
      ) {
        fail(
          'command-failed',
          `${name} failed (${result.status}, exit ${result.exitCode ?? 'none'}); see the command ledger.`,
        );
      }
      if (progressError) throw progressError;
      return result;
    } finally {
      running = false;
    }
  };
  const git = async (root, args, name, options = {}) => {
    const result = await run(
      name,
      'git',
      [
        '--no-pager',
        '--no-optional-locks',
        ...(['add', 'diff', 'ls-files', 'status'].includes(args[0]) ? ['--literal-pathspecs'] : []),
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.autocrlf=false',
        '-c',
        `core.hooksPath=${join(root, '.git', 'maintenance-loop-disabled-hooks')}`,
        '-c',
        'commit.gpgSign=false',
        '-c',
        'user.name=Maintenance Loop Fixture',
        '-c',
        'user.email=maintenance-loop@example.invalid',
        ...args,
      ],
      { ...options, cwd: root },
    );
    return result.stdout;
  };
  return { run, git, steps };
}
