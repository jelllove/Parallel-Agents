import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { prepareReportDirectory } from './ci-report.mjs';

const execFileAsync = promisify(execFile);
export const scannerModule = 'github.com/zricethezav/gitleaks/v8@v8.30.1';
const binaryExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.mp4',
  '.mp3',
  '.wav',
  '.pdf',
  '.zip',
  '.gz',
  '.7z',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.exe',
  '.dll',
  '.node',
]);

async function inspectSourcePath(root, name) {
  const parts = name.split(/[\\/]/);
  if (isAbsolute(name) || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid Git source path: ${name}`);
  }
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Secret scanning does not follow links: ${name}`);
  }
  const info = await lstat(path);
  if (!info.isFile()) throw new Error(`Expected a regular source file: ${name}`);
  return { path, info };
}

export async function createSourceSnapshot(
  root,
  { maxFileBytes = 5 * 1024 * 1024, maxTotalBytes = 50 * 1024 * 1024 } = {},
) {
  const canonicalRoot = await realpath(root);
  const { stdout } = await execFileAsync(
    'git',
    [
      '--no-pager',
      '-C',
      canonicalRoot,
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
    ],
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  );
  const names = [...new Set(stdout.split('\0').filter(Boolean))].sort();
  const directory = await mkdtemp(join(tmpdir(), 'parallel-agents-source-scan-'));
  const cleanup = () =>
    rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  const files = [];
  const excludedBinaryFiles = [];
  const missingFiles = [];
  let totalBytes = 0;
  try {
    for (const name of names) {
      let source;
      try {
        source = await inspectSourcePath(canonicalRoot, name);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        missingFiles.push(name);
        continue;
      }
      if (binaryExtensions.has(extname(name).toLowerCase())) {
        excludedBinaryFiles.push(name);
        continue;
      }
      if (source.info.size > maxFileBytes)
        throw new Error(`Source file exceeds scan size limit: ${name}`);
      const content = await readFile(source.path);
      if (content.includes(0))
        throw new Error(`Unrecognized binary or non-UTF8 source requires review: ${name}`);
      totalBytes += content.length;
      if (totalBytes > maxTotalBytes)
        throw new Error('Source snapshot exceeds the total scan size limit.');
      const destination = join(directory, ...name.split(/[\\/]/));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content, { flag: 'wx' });
      files.push(name);
    }
    if (!files.length) throw new Error('No source files found for secret scanning.');
    return { directory, files, excludedBinaryFiles, missingFiles, totalBytes, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function ensureScanner(root) {
  const tools = await prepareReportDirectory(root, 'tools');
  const installDirectory = join(tools, 'gitleaks-v8.30.1');
  await mkdir(installDirectory, { recursive: true });
  const folder = await lstat(installDirectory);
  if (folder.isSymbolicLink() || !folder.isDirectory())
    throw new Error('Scanner cache must be a real directory.');
  const binary = join(installDirectory, process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');
  try {
    const info = await lstat(binary);
    if (info.isSymbolicLink() || !info.isFile())
      throw new Error('Scanner must be a regular executable file.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await execFileAsync('go', ['install', scannerModule], {
      cwd: root,
      env: { ...process.env, GOBIN: installDirectory, GOWORK: 'off' },
      windowsHide: true,
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  }
  const { stdout } = await execFileAsync('go', ['version', '-m', binary], { windowsHide: true });
  if (!stdout.includes('github.com/zricethezav/gitleaks/v8\tv8.30.1')) {
    throw new Error('The cached secret scanner does not match the pinned module version.');
  }
  return binary;
}

export function scannerArguments(snapshot, config, report) {
  return [
    'dir',
    snapshot,
    '--config',
    config,
    '--report-format=sarif',
    '--report-path',
    report,
    '--redact=100',
    '--exit-code=10',
    '--timeout=120',
    '--max-archive-depth=0',
    '--ignore-gitleaks-allow',
    '--no-banner',
    '--no-color',
    '--log-level=warn',
  ];
}

export async function scanRepository(root) {
  const canonicalRoot = await realpath(root);
  const scanner = await ensureScanner(canonicalRoot);
  const outputRoot = await prepareReportDirectory(canonicalRoot, 'security');
  const runDirectory = join(outputRoot, `${Date.now()}-${randomUUID()}`);
  await mkdir(runDirectory);
  const sarifPath = join(runDirectory, 'gitleaks.sarif');
  const snapshot = await createSourceSnapshot(canonicalRoot);
  try {
    const env = { ...process.env };
    delete env.GITLEAKS_CONFIG;
    delete env.GITLEAKS_CONFIG_TOML;
    let status = 'clean';
    try {
      const result = await execFileAsync(
        scanner,
        scannerArguments(snapshot.directory, join(canonicalRoot, '.gitleaks.toml'), sarifPath),
        {
          cwd: snapshot.directory,
          env,
          windowsHide: true,
          timeout: 130_000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      if (result.stderr) process.stderr.write(result.stderr);
    } catch (error) {
      if (error.code !== 10) throw error;
      status = 'findings';
      if (error.stderr) process.stderr.write(error.stderr);
    }
    const receipt = {
      schemaVersion: 1,
      scanner: scannerModule,
      status,
      scannedFiles: snapshot.files.length,
      scannedBytes: snapshot.totalBytes,
      excludedBinaryFiles: snapshot.excludedBinaryFiles,
      missingWorkingFiles: snapshot.missingFiles,
      scope:
        'Git-visible working-tree text; ignored files and known binary media excluded; no archive expansion.',
      redaction: '100%',
      sarifPath,
    };
    const receiptPath = join(runDirectory, 'report.json');
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    return { ...receipt, receiptPath };
  } finally {
    await snapshot.cleanup();
  }
}

if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1]))) === (await realpath(fileURLToPath(import.meta.url)))
) {
  try {
    if (process.argv.length > 2) throw new Error('Usage: node scripts/scan-secrets.mjs');
    const report = await scanRepository(process.cwd());
    console.log(
      `${report.status}: scanned ${report.scannedFiles} source files; redacted report: ${report.receiptPath}`,
    );
    if (report.status !== 'clean') process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
