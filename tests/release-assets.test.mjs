import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inspectReleaseAssets } from '../scripts/release-assets.mjs';

const names = (platform, arch = platform === 'darwin' ? 'arm64' : 'x64') =>
  platform === 'win32'
    ? [
        'Parallel-Agents-Setup-0.1.16.exe',
        'Parallel-Agents-Setup-0.1.16.exe.blockmap',
        'latest.yml',
        'Parallel-Agents-0.1.16-win-x64.zip',
      ]
    : platform === 'darwin'
      ? [`Parallel-Agents-0.1.16-mac-${arch}.dmg`, `Parallel-Agents-0.1.16-mac-${arch}.zip`]
      : [
          'Parallel-Agents-0.1.16-linux-x86_64.AppImage',
          'Parallel-Agents-0.1.16-linux-amd64.deb',
          'Parallel-Agents-0.1.16-linux-x86_64.rpm',
          'Parallel-Agents-0.1.16-linux-x64.tar.gz',
        ];

async function fixture(t, platform = 'win32', arch = platform === 'darwin' ? 'arm64' : 'x64') {
  const root = await mkdtemp(join(tmpdir(), 'parallel-agents-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'release'));
  await mkdir(join(root, 'reports'));
  const smoke = { success: true, platform, arch, packaged: false, initialJavaScriptBytes: 200000 };
  await writeFile(join(root, 'reports', 'smoke.json'), JSON.stringify(smoke));
  await writeFile(
    join(root, 'reports', 'packaged-smoke.json'),
    JSON.stringify({ ...smoke, packaged: true }),
  );
  for (const name of names(platform, arch)) {
    await writeFile(join(root, 'release', name), 'fixture-package-bytes');
  }
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.1.16' }));
  return { root, platform, arch };
}

for (const [platform, arch] of [
  ['win32', 'x64'],
  ['darwin', 'arm64'],
  ['darwin', 'x64'],
  ['linux', 'x64'],
]) {
  test(`release evidence requires every ${platform}/${arch} package and records actual SHA256`, async (t) => {
    const { root } = await fixture(t, platform, arch);
    const result = await inspectReleaseAssets(root, platform, arch);
    assert.equal(result.version, '0.1.16');
    assert.equal(result.platform, platform);
    assert.deepEqual(
      result.assets.map((asset) => asset.name),
      names(platform, arch),
    );
    for (const asset of result.assets) {
      assert.match(asset.sha256, /^[a-f0-9]{64}$/);
      assert.equal(asset.bytes, 21);
    }
  });
}

test('a missing or empty package fails publication readiness', async (t) => {
  const { root, platform, arch } = await fixture(t);
  await rm(join(root, 'release', names(platform)[0]));
  await assert.rejects(inspectReleaseAssets(root, platform, arch), /ENOENT/);
  await writeFile(join(root, 'release', names(platform)[0]), '');
  await assert.rejects(inspectReleaseAssets(root, platform, arch), /empty|regular/i);
});

for (const extension of ['deb', 'rpm', 'tar.gz']) {
  test(`Linux release readiness rejects a missing or empty ${extension} even when other formats exist`, async (t) => {
    const { root, platform, arch } = await fixture(t, 'linux');
    const name = names(platform).find((name) => name.endsWith(`.${extension}`));
    const asset = join(root, 'release', name);
    await rm(asset);
    await assert.rejects(
      inspectReleaseAssets(root, platform, arch),
      (error) => error.code === 'ENOENT' && error.path === asset,
    );
    await writeFile(asset, '');
    await assert.rejects(inspectReleaseAssets(root, platform, arch), /empty|regular/i);
  });
}

test('Windows release readiness requires its portable ZIP as well as NSIS', async (t) => {
  const { root, platform, arch } = await fixture(t);
  const archive = join(root, 'release', 'Parallel-Agents-0.1.16-win-x64.zip');
  await rm(archive);
  await assert.rejects(
    inspectReleaseAssets(root, platform, arch),
    (error) => error.code === 'ENOENT' && error.path === archive,
  );
});

test('Intel release assets cannot use ARM64 native receipts', async (t) => {
  const { root } = await fixture(t, 'darwin', 'x64');
  const receipt = {
    success: true,
    platform: 'darwin',
    arch: 'arm64',
    packaged: true,
    initialJavaScriptBytes: 200000,
  };
  await writeFile(join(root, 'reports', 'packaged-smoke.json'), JSON.stringify(receipt));
  await assert.rejects(inspectReleaseAssets(root, 'darwin', 'x64'), /smoke/i);
});

test('a symlink cannot substitute for a release asset', async (t) => {
  const { root, platform, arch } = await fixture(t);
  const asset = join(root, 'release', names(platform)[0]);
  await rm(asset);
  try {
    await symlink(join(root, 'package.json'), asset);
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM')
      return t.skip('Windows symlink permission unavailable');
    throw error;
  }
  await assert.rejects(inspectReleaseAssets(root, platform, arch), /regular/i);
});

for (const change of [
  { success: false },
  { packaged: false },
  { platform: 'linux' },
  { arch: 'arm64' },
  { initialJavaScriptBytes: 800000 },
]) {
  test(`wrong or failed native receipt prevents release readiness: ${JSON.stringify(change)}`, async (t) => {
    const { root, platform, arch } = await fixture(t);
    const path = join(root, 'reports', 'packaged-smoke.json');
    await writeFile(
      path,
      JSON.stringify({
        success: true,
        platform,
        arch,
        packaged: true,
        initialJavaScriptBytes: 200000,
        ...change,
      }),
    );
    await assert.rejects(inspectReleaseAssets(root, platform, arch), /smoke/i);
  });
}
