import { execFile } from 'node:child_process';
import { lstat, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { prepareReportDirectory } from './ci-report.mjs';
import { withoutRepositoryGitEnvironment } from './git-environment.mjs';

const execFileAsync = promisify(execFile);
const isolation = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'tests',
  'helpers',
  'isolated-git.mjs',
);

export async function runTests(root) {
  const reportRoot = await prepareReportDirectory(root, 'tests');
  const directory = await mkdtemp(join(reportRoot, 'run-'));
  const junitPath = join(directory, 'junit.xml');
  const coveragePath = join(directory, 'coverage.lcov');
  const args = [
    '--test',
    '--test-concurrency=4',
    '--import',
    pathToFileURL(isolation).href,
    '--experimental-strip-types',
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    '--experimental-test-coverage',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=junit',
    `--test-reporter-destination=${junitPath}`,
    '--test-reporter=lcov',
    `--test-reporter-destination=${coveragePath}`,
    'tests/*.test.mjs',
  ];
  const startedAt = new Date().toISOString();
  const environment = withoutRepositoryGitEnvironment(process.env);
  delete environment.NODE_TEST_CONTEXT;
  let exitCode = 0;
  let output;
  try {
    output = await execFileAsync(process.execPath, args, {
      cwd: root,
      env: environment,
      windowsHide: true,
      timeout: 600_000,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    if (!Number.isInteger(error.code) || error.code < 0) throw error;
    exitCode = error.code;
    output = { stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
  if (exitCode === 0) {
    for (const path of [junitPath, coveragePath]) {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(`Successful test execution did not produce a regular report: ${path}`);
      }
    }
  }
  const receiptPath = join(directory, 'result.json');
  await writeFile(
    receiptPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode,
        command: [process.execPath, ...args],
        scope: 'Node unit and regression tests; native Electron and live providers are separate.',
        junitPath,
        coveragePath,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  return { exitCode, directory, junitPath, coveragePath, receiptPath, ...output };
}

if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1]))) === (await realpath(fileURLToPath(import.meta.url)))
) {
  try {
    if (process.argv.length > 2) throw new Error('Usage: node scripts/test-ci.mjs');
    const result = await runTests(process.cwd());
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    console.log(`Test artifacts: ${result.directory}`);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
