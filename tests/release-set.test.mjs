import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { requiredReleaseAssets, releaseTargets } from '../scripts/release-assets.mjs';
import { verifyReleaseSet, stageReleaseSet } from '../scripts/verify-release-set.mjs';

const execFileAsync = promisify(execFile);
const version = '0.1.17';
const sourceCommit = 'a'.repeat(40);
const options = (root) => ({ artifactsRoot: root, version, sourceCommit });

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'parallel-agents-release-set-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifactsRoot = join(root, 'download');
  const receipts = new Map();
  for (const { label, platform, arch } of releaseTargets) {
    const packages = join(artifactsRoot, `packages-${label}`);
    const reportDir = join(
      artifactsRoot,
      `release-evidence-${label}`,
      'release-assets',
      'run-fixture',
    );
    await mkdir(packages, { recursive: true });
    await mkdir(reportDir, { recursive: true });
    const assets = [];
    for (const name of requiredReleaseAssets(version, platform, arch)) {
      const content = Buffer.from(`inert ${label} ${name}\n`);
      await writeFile(join(packages, name), content);
      assets.push({
        name,
        bytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
      });
    }
    const receipt = {
      schemaVersion: 1,
      version,
      sourceCommit,
      platform,
      arch,
      assets,
      smoke: [false, true].map((packaged) => ({
        success: true,
        platform,
        arch,
        packaged,
        initialJavaScriptBytes: 200000,
      })),
    };
    const path = join(reportDir, 'assets.json');
    await writeFile(path, JSON.stringify(receipt));
    receipts.set(label, { path, receipt, packages });
  }
  return { root, artifactsRoot, receipts };
}

test('full release set requires all four native targets and all twelve mandatory files', async (t) => {
  const { artifactsRoot } = await fixture(t);
  const result = await verifyReleaseSet(options(artifactsRoot));
  assert.equal(result.version, version);
  assert.equal(result.sourceCommit, sourceCommit);
  assert.deepEqual(
    result.targets.map((target) => target.label),
    ['Windows', 'macOS', 'macOS-Intel', 'Linux'],
  );
  assert.equal(result.assets.length, 12);
});

for (const label of ['Windows', 'macOS', 'macOS-Intel', 'Linux']) {
  test(`one missing OS/architecture blocks publication readiness: ${label}`, async (t) => {
    const { artifactsRoot, receipts } = await fixture(t);
    await rm(receipts.get(label).packages, { recursive: true });
    await assert.rejects(verifyReleaseSet(options(artifactsRoot)), /ENOENT|missing/i);
  });
}

for (const [label, suffix] of [
  ['Windows', '.zip'],
  ['Linux', '.deb'],
  ['Linux', '.rpm'],
  ['Linux', '.tar.gz'],
  ['macOS-Intel', '.dmg'],
]) {
  test(`a missing or empty ${label} ${suffix} is not a complete release`, async (t) => {
    const { artifactsRoot, receipts } = await fixture(t);
    const { packages, receipt } = receipts.get(label);
    const name = receipt.assets.find((asset) => asset.name.endsWith(suffix)).name;
    await rm(join(packages, name));
    await assert.rejects(verifyReleaseSet(options(artifactsRoot)), /missing|required|ENOENT/i);
    await writeFile(join(packages, name), '');
    await assert.rejects(verifyReleaseSet(options(artifactsRoot)), /empty|regular/i);
  });
}

for (const patch of [
  { sourceCommit: 'b'.repeat(40) },
  { version: '0.1.16' },
  { arch: 'arm64' },
  { schemaVersion: 99 },
]) {
  test(`receipt mismatch rejects mixed native artifacts: ${JSON.stringify(patch)}`, async (t) => {
    const { artifactsRoot, receipts } = await fixture(t);
    const { path, receipt } = receipts.get('macOS-Intel');
    await writeFile(path, JSON.stringify({ ...receipt, ...patch }));
    await assert.rejects(
      verifyReleaseSet(options(artifactsRoot)),
      /receipt|source|version|architecture|schema/i,
    );
  });
}

for (const patch of [
  { success: false },
  { packaged: false },
  { initialJavaScriptBytes: 800000 },
  { arch: 'arm64' },
]) {
  test(`failed or incorrect packaged smoke is rejected: ${JSON.stringify(patch)}`, async (t) => {
    const { artifactsRoot, receipts } = await fixture(t);
    const { path, receipt } = receipts.get('Windows');
    receipt.smoke[1] = { ...receipt.smoke[1], ...patch };
    await writeFile(path, JSON.stringify(receipt));
    await assert.rejects(verifyReleaseSet(options(artifactsRoot)), /smoke/i);
  });
}

test('changed bytes and forged checksum declarations fail explicitly', async (t) => {
  const { artifactsRoot, receipts } = await fixture(t);
  const { path, receipt, packages } = receipts.get('Linux');
  const asset = receipt.assets[0];
  await writeFile(join(packages, asset.name), 'corrupt package');
  await assert.rejects(verifyReleaseSet(options(artifactsRoot)), /hash|size|checksum/i);
  asset.sha256 = 'not a digest';
  await writeFile(path, JSON.stringify(receipt));
  await assert.rejects(verifyReleaseSet(options(artifactsRoot)), /hash|digest|checksum/i);
});

test('duplicate/path-traversal declarations and unexpected package files are rejected', async (t) => {
  const { artifactsRoot, receipts } = await fixture(t);
  const { path, receipt, packages } = receipts.get('Linux');
  receipt.assets.push({ ...receipt.assets[0], name: '../escape.deb' });
  await writeFile(path, JSON.stringify(receipt));
  await assert.rejects(verifyReleaseSet(options(artifactsRoot)), /asset|name|receipt/i);
  receipt.assets.pop();
  await writeFile(path, JSON.stringify(receipt));
  await writeFile(join(packages, 'unreviewed.exe'), 'inert');
  await assert.rejects(verifyReleaseSet(options(artifactsRoot)), /unexpected/i);
});

test('ambiguous receipts cannot be selected as the convenient success', async (t) => {
  const { artifactsRoot, receipts } = await fixture(t);
  const directory = join(artifactsRoot, 'release-evidence-Linux', 'release-assets', 'run-other');
  await mkdir(directory);
  await writeFile(join(directory, 'assets.json'), JSON.stringify(receipts.get('Linux').receipt));
  await assert.rejects(verifyReleaseSet(options(artifactsRoot)), /one|ambiguous|receipt/i);
});

test('artifact-directory junctions cannot redirect verification outside the download', async (t) => {
  const { root, artifactsRoot, receipts } = await fixture(t);
  const directory = receipts.get('Linux').packages;
  const outside = join(root, 'outside');
  await mkdir(outside);
  await rm(directory, { recursive: true });
  await symlink(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(verifyReleaseSet(options(artifactsRoot)), /link|outside/i);
});

test('the only extra assets accepted are blockmaps belonging to required archives', async (t) => {
  const { artifactsRoot, receipts } = await fixture(t);
  const { packages } = receipts.get('macOS');
  const blockmap = 'Parallel-Agents-0.1.17-mac-arm64.dmg.blockmap';
  await writeFile(join(packages, blockmap), 'inert blockmap');
  const result = await verifyReleaseSet(options(artifactsRoot));
  assert.ok(result.assets.some((asset) => asset.name === blockmap));
});

test('validated publication folders are fresh, retain checksums and preserve previous outputs', async (t) => {
  const { root, artifactsRoot } = await fixture(t);
  const first = await stageReleaseSet(root, options(artifactsRoot));
  const second = await stageReleaseSet(root, options(artifactsRoot));
  assert.notEqual(first, second);
  assert.equal((await readdir(first)).length, 14);
  const checksums = await readFile(join(first, 'SHA256SUMS'), 'utf8');
  assert.equal(checksums.trim().split('\n').length, 12);
  const manifest = JSON.parse(await readFile(join(first, 'release-set.json'), 'utf8'));
  assert.equal(manifest.sourceCommit, sourceCommit);
  assert.equal(manifest.targets.length, 4);
});

test('failed verification creates no success-shaped publication folder', async (t) => {
  const { root, artifactsRoot, receipts } = await fixture(t);
  await rm(receipts.get('macOS-Intel').packages, { recursive: true });
  await assert.rejects(stageReleaseSet(root, options(artifactsRoot)), /ENOENT|missing/i);
  await assert.rejects(readdir(join(root, 'reports')), /ENOENT/);
});

test('release-set CLI rejects missing arguments without touching real release artifacts', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ['scripts/verify-release-set.mjs']),
    (error) => error.code !== 0 && /Usage:/.test(error.stderr),
  );
});

test('release authoring is discoverable and CI has a dependent complete-set gate', async () => {
  const guide = await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8');
  assert.match(guide, /release-authoring\/SKILL\.md/);
  const skill = await readFile(
    new URL('../.github/skills/release-authoring/SKILL.md', import.meta.url),
    'utf8',
  );
  assert.match(skill, /name: release-authoring/);
  assert.match(skill, /verify:release/);
  const workflow = await readFile(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /Verify complete release set/);
  assert.match(workflow, /needs: package/);
  assert.match(workflow, /download-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /node scripts\/verify-release-set\.mjs/);
  assert.match(workflow, /verified-release-set/);
});
