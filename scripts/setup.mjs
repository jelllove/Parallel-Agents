import { spawnSync } from 'node:child_process';

import {
  commandExitCode,
  commandFailure,
  isMain,
  parseOptions,
  usage,
} from './dev-environment.mjs';
import { diagnose, formatDiagnostics } from './doctor.mjs';
import { withoutRepositoryGitEnvironment } from './git-environment.mjs';

export function setup(options = {}) {
  const {
    run = spawnSync,
    env = process.env,
    nodePath = process.execPath,
    log = console.log,
  } = options;
  const childEnv = withoutRepositoryGitEnvironment(env);
  const report = diagnose({ ...options, env: childEnv });
  const completed = [];
  log(formatDiagnostics(report));
  if (!report.ok) {
    log('Setup stopped before installation. Fix the mandatory prerequisites and retry.');
    return { exitCode: 1, report, completed };
  }
  log(
    'Setup installs locked dependencies (registry downloads and dependency lifecycle scripts enabled), then runs npm run check. It requests no global installs, Git configuration, hooks, source rebuild, native smoke, desktop launch or packaging.',
  );
  const steps = [
    {
      label: 'npm ci',
      args: [
        'ci',
        '--include=dev',
        '--include=optional',
        '--ignore-scripts=false',
        '--no-audit',
        '--no-fund',
      ],
    },
    { label: 'npm run check', args: ['run', 'check'] },
  ];
  for (const step of steps) {
    log(`> ${step.label}`);
    const result = run(nodePath, [report.npmCli.path, ...step.args], {
      cwd: report.root,
      env: childEnv,
      stdio: 'inherit',
      timeout: 900_000,
      windowsHide: true,
      shell: false,
    });
    const failure = commandFailure(result);
    if (failure) {
      log(`Setup stopped: ${step.label} failed (${failure}). Later steps were not run.`);
      return { exitCode: commandExitCode(result), report, completed };
    }
    completed.push(step.label);
  }
  log(
    'Setup complete: locked install and non-GUI checks passed. No native/runtime result is implied.',
  );
  return { exitCode: 0, report, completed };
}

if (isMain(import.meta.url)) {
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n${usage('setup')}`);
    process.exitCode = 2;
  }
  if (options?.help) {
    console.log(usage('setup'));
    console.log(
      'Runs prerequisite diagnostics, npm ci --include=dev --include=optional --ignore-scripts=false --no-audit --no-fund, then npm run check. Each command has a 15-minute timeout; stops on first failure and preserves its exit status.',
    );
    console.log(
      'Installation can replace node_modules and download packages. Dependency lifecycle scripts run for upstream prebuild/Electron installation. This does not install global tools or hooks, run rebuild, format source, launch the app, package it, or request provider authentication.',
    );
  } else if (options) {
    process.exitCode = setup(options).exitCode;
  }
}
