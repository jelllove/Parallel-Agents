import { constants } from 'node:fs';
import { copyFile, lstat, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareReportDirectory } from './ci-report.mjs';
import { readReleaseAsset, releaseTargets, requiredReleaseAssets } from './release-assets.mjs';

async function containedPath(root, parts, kind) {
  let path = root;
  for (const [index, part] of parts.entries()) {
    path = join(path, part);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Release input must not be a link: ${path}`);
    const directory = index < parts.length - 1 || kind === 'directory';
    if (directory ? !info.isDirectory() : !info.isFile())
      throw new Error(`Expected regular release ${directory ? 'directory' : 'file'}: ${path}`);
  }
  const suffix = relative(root, await realpath(path));
  if (suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix))
    throw new Error(`Release input resolves outside its download: ${path}`);
  return path;
}

function verifyReceipt(receipt, target, required, version, sourceCommit) {
  const { label, platform, arch } = target;
  if (
    receipt?.schemaVersion !== 1 ||
    receipt.version !== version ||
    receipt.sourceCommit !== sourceCommit ||
    receipt.platform !== platform ||
    receipt.arch !== arch
  ) {
    throw new Error(`${label}: receipt schema/version/source/architecture mismatch.`);
  }
  if (
    !Array.isArray(receipt.smoke) ||
    receipt.smoke.length !== 2 ||
    receipt.smoke.some(
      (smoke, index) =>
        smoke?.success !== true ||
        smoke.platform !== platform ||
        smoke.arch !== arch ||
        smoke.packaged !== (index === 1) ||
        !Number.isInteger(smoke.initialJavaScriptBytes) ||
        smoke.initialJavaScriptBytes < 0 ||
        smoke.initialJavaScriptBytes >= 800000,
    )
  ) {
    throw new Error(`${label}: native/packaged smoke receipts are not successful for this target.`);
  }
  if (
    !Array.isArray(receipt.assets) ||
    receipt.assets.length !== required.length ||
    new Set(receipt.assets.map((asset) => asset?.name)).size !== required.length ||
    receipt.assets.some(
      (asset) =>
        !required.includes(asset?.name) ||
        !Number.isSafeInteger(asset.bytes) ||
        asset.bytes <= 0 ||
        !/^[a-f0-9]{64}$/.test(asset.sha256),
    )
  ) {
    throw new Error(`${label}: required asset names, sizes or checksum declarations are invalid.`);
  }
}

export async function verifyReleaseSet({ artifactsRoot, version, sourceCommit }) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit))
    throw new Error('Expected an exact 40-character source commit.');
  requiredReleaseAssets(version, 'win32', 'x64');
  if ((await lstat(artifactsRoot)).isSymbolicLink())
    throw new Error('Release download root must not be a link.');
  const root = await realpath(artifactsRoot);
  const assets = [];
  const targets = [];
  const names = new Set();
  for (const target of releaseTargets) {
    const { label, platform, arch } = target;
    const required = requiredReleaseAssets(version, platform, arch);
    const packages = await containedPath(root, [`packages-${label}`], 'directory');
    const reportParts = [`release-evidence-${label}`, 'release-assets'];
    const reports = await containedPath(root, reportParts, 'directory');
    const runs = await readdir(reports);
    if (runs.length !== 1 || !/^run-[a-zA-Z0-9-]+$/.test(runs[0]))
      throw new Error(`${label}: expected exactly one unambiguous native receipt.`);
    const receiptPath = await containedPath(root, [...reportParts, runs[0], 'assets.json'], 'file');
    if ((await lstat(receiptPath)).size > 512 * 1024)
      throw new Error(`${label}: native receipt is too large.`);
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    verifyReceipt(receipt, target, required, version, sourceCommit);
    const uploaded = await readdir(packages);
    for (const name of required) {
      if (!uploaded.includes(name))
        throw new Error(`${label}: missing required release asset ${name}.`);
    }
    const optional = required
      .filter((name) => name.endsWith('.dmg') || name.endsWith('.zip'))
      .map((name) => `${name}.blockmap`);
    for (const name of uploaded.sort()) {
      if (!required.includes(name) && !optional.includes(name))
        throw new Error(`${label}: unexpected release asset ${name}.`);
      if (names.has(name)) throw new Error(`Duplicate release asset across targets: ${name}.`);
      const path = await containedPath(root, [`packages-${label}`, name], 'file');
      const actual = await readReleaseAsset(path);
      const declared = receipt.assets.find((asset) => asset.name === name);
      if (declared && (declared.bytes !== actual.bytes || declared.sha256 !== actual.sha256))
        throw new Error(`${label}: asset size/checksum mismatch for ${name}.`);
      names.add(name);
      assets.push({ name, label, ...actual });
    }
    targets.push({ ...target, nativeSmoke: true, packagedSmoke: true });
  }
  return {
    schemaVersion: 1,
    evidenceSource: 'native-artifact-consistency-check',
    version,
    sourceCommit,
    targets,
    assets,
  };
}

export async function stageReleaseSet(root, options) {
  const manifest = await verifyReleaseSet(options);
  const output = await mkdtemp(join(await prepareReportDirectory(root, 'release-sets'), 'run-'));
  const input = await realpath(options.artifactsRoot);
  for (const asset of manifest.assets) {
    const source = await containedPath(input, [`packages-${asset.label}`, asset.name], 'file');
    const destination = join(output, asset.name);
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    const actual = await readReleaseAsset(destination);
    if (actual.bytes !== asset.bytes || actual.sha256 !== asset.sha256)
      throw new Error(`Release asset changed during staging: ${asset.name}.`);
  }
  await writeFile(
    join(output, 'SHA256SUMS'),
    manifest.assets.map((asset) => `${asset.sha256}  ${asset.name}`).join('\n') + '\n',
    { flag: 'wx' },
  );
  await writeFile(join(output, 'release-set.json'), JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx',
  });
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (
    args.length !== 4 ||
    args[0] !== '--artifacts' ||
    !args[1] ||
    args[2] !== '--commit' ||
    !/^[a-f0-9]{40}$/.test(args[3])
  ) {
    throw new Error(
      'Usage: node scripts/verify-release-set.mjs --artifacts <download-directory> --commit <source-sha>',
    );
  }
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const output = await stageReleaseSet(root, {
    artifactsRoot: resolve(args[1]),
    version,
    sourceCommit: args[3],
  });
  console.log(`Complete four-target release set verified and staged: ${output}`);
}
