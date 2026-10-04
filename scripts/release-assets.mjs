import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopTarget } from './desktop-targets.mjs';
import { prepareReportDirectory } from './ci-report.mjs';

export async function inspectReleaseAssets(root, platform, arch) {
  desktopTarget(platform, arch);
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable package version.');
  const names =
    platform === 'win32'
      ? [
          `Parallel-Agents-Setup-${version}.exe`,
          `Parallel-Agents-Setup-${version}.exe.blockmap`,
          'latest.yml',
        ]
      : platform === 'darwin'
        ? [`Parallel-Agents-${version}-mac-arm64.dmg`, `Parallel-Agents-${version}-mac-arm64.zip`]
        : [
            `Parallel-Agents-${version}-linux-x86_64.AppImage`,
            `Parallel-Agents-${version}-linux-amd64.deb`,
          ];
  const smoke = [];
  for (const [name, packaged] of [
    ['smoke', false],
    ['packaged-smoke', true],
  ]) {
    const receipt = JSON.parse(await readFile(join(root, 'reports', `${name}.json`), 'utf8'));
    if (
      receipt.success !== true ||
      receipt.platform !== platform ||
      receipt.arch !== arch ||
      receipt.packaged !== packaged ||
      !Number.isFinite(receipt.initialJavaScriptBytes) ||
      receipt.initialJavaScriptBytes >= 800000
    ) {
      throw new Error(`Missing successful ${platform}/${arch} ${name} evidence.`);
    }
    smoke.push({ name, ...receipt });
  }
  const assets = [];
  for (const name of names) {
    const path = join(root, 'release', name);
    const info = await lstat(path);
    if (!info.isFile() || info.size === 0)
      throw new Error(`Expected nonempty regular asset: ${name}`);
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(path)) digest.update(chunk);
    assets.push({ name, bytes: info.size, sha256: digest.digest('hex') });
  }
  return { schemaVersion: 1, version, platform, arch, assets, smoke };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/release-assets.mjs');
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const report = await inspectReleaseAssets(root, process.platform, process.arch);
  const run = await mkdtemp(join(await prepareReportDirectory(root, 'release-assets'), 'run-'));
  const path = join(run, 'assets.json');
  await writeFile(
    path,
    JSON.stringify({ ...report, sourceCommit: process.env.GITHUB_SHA ?? null }, null, 2) + '\n',
    { flag: 'wx' },
  );
  console.log(
    `Verified ${report.assets.length} release assets for ${report.platform}/${report.arch}: ${path}`,
  );
}
