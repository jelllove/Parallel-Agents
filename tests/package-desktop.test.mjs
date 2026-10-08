import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { packagingArguments, packageDesktop } from '../scripts/package-desktop.mjs';

const configuration = {
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'zip', arch: ['x64'] },
    ],
  },
  mac: {
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
  },
  linux: {
    target: ['AppImage', 'deb', 'rpm', 'tar.gz'].map((target) => ({ target, arch: ['x64'] })),
  },
};

for (const [platform, arch, flag, targets] of [
  ['win32', 'x64', '--win', ['nsis', 'zip']],
  ['darwin', 'arm64', '--mac', ['dmg', 'zip']],
  ['darwin', 'x64', '--mac', ['dmg', 'zip']],
  ['linux', 'x64', '--linux', ['AppImage', 'deb', 'rpm', 'tar.gz']],
]) {
  test(`packaging selects only the native ${platform}/${arch} architecture and never publishes`, () => {
    assert.deepEqual(packagingArguments(platform, arch, false, configuration), [
      flag,
      ...targets,
      `--${arch}`,
      '--publish',
      'never',
    ]);
    assert.deepEqual(packagingArguments(platform, arch, true, configuration), [
      flag,
      'dir',
      `--${arch}`,
      '--publish',
      'never',
    ]);
  });
}

test('unsupported native hosts fail before invoking any builder', () => {
  for (const [platform, arch] of [
    ['win32', 'arm64'],
    ['linux', 'arm64'],
    ['freebsd', 'x64'],
  ]) {
    assert.throws(
      () =>
        packageDesktop({
          root: '.',
          platform,
          arch,
          run: () => assert.fail('builder must not run'),
        }),
      /Unsupported desktop target/,
    );
  }
});

test('packaging launches the existing builder through Node with proxy/timeout support', () => {
  const root = join(process.cwd(), 'reports', 'fake-packaging-root');
  let invoked = false;
  const result = packageDesktop({
    root,
    platform: 'darwin',
    arch: 'x64',
    unpacked: true,
    configuration,
    run(command, args, options) {
      invoked = true;
      assert.equal(command, process.execPath);
      assert.deepEqual(args, [
        '--use-env-proxy',
        '--import',
        pathToFileURL(join(root, 'scripts', 'fetch-downloads.mjs')).href,
        join(root, 'node_modules', 'electron-builder', 'cli.js'),
        '--mac',
        'dir',
        '--x64',
        '--publish',
        'never',
      ]);
      assert.equal(options.cwd, root);
      assert.equal(options.stdio, 'inherit');
      return { status: 0 };
    },
  });

  assert.equal(result, 0);
  assert.equal(invoked, true);
});

test('packaging preload works with actual Node and paths containing spaces', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'parallel-agents package fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'node_modules', 'electron-builder'), { recursive: true });
  await writeFile(
    join(root, 'scripts', 'fetch-downloads.mjs'),
    'globalThis.fixturePreload = true;\n',
  );
  await writeFile(
    join(root, 'node_modules', 'electron-builder', 'cli.js'),
    'if (!globalThis.fixturePreload) throw new Error("preload missing"); console.log("FIXTURE_PACKAGING_READY");\n',
  );
  const result = packageDesktop({
    root,
    platform: 'win32',
    arch: 'x64',
    configuration,
    run(command, args, options) {
      const child = spawnSync(command, args, { ...options, stdio: 'pipe', encoding: 'utf8' });
      assert.equal(child.status, 0, child.stderr);
      assert.match(child.stdout, /FIXTURE_PACKAGING_READY/);
      return child;
    },
  });
  assert.equal(result, 0);
});

test('builder failures retain nonzero exit status and emit diagnostics', (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const result = packageDesktop({
    root: '.',
    platform: 'win32',
    arch: 'x64',
    configuration,
    run: () => ({ status: 7 }),
  });
  assert.equal(result, 7);
  assert.equal(error.mock.callCount(), 1);
  assert.match(error.mock.calls[0].arguments[0], /7/);
});

test('spawn errors, killed processes and missing status are not success-shaped', () => {
  const failed = new Error('builder unavailable');
  for (const [result, expected] of [
    [{ error: failed }, /builder unavailable/],
    [{ signal: 'SIGTERM', status: null }, /SIGTERM/],
    [{ status: null }, /exit status/],
  ]) {
    assert.throws(
      () =>
        packageDesktop({
          root: '.',
          platform: 'linux',
          arch: 'x64',
          configuration,
          run: () => result,
        }),
      expected,
    );
  }
});

test('explicit Mac target names prevent the builder from re-expanding both configured architectures', async () => {
  const { Arch } = await import('builder-util');
  const { computeArchToTargetNamesMap } =
    await import('app-builder-lib/out/targets/targetFactory.js');
  for (const [arch, value] of [
    ['x64', Arch.x64],
    ['arm64', Arch.arm64],
  ]) {
    const args = packagingArguments('darwin', arch, false, configuration);
    const targets = args.slice(1, args.indexOf(`--${arch}`));
    const map = computeArchToTargetNamesMap(
      new Map([[value, targets]]),
      { platformSpecificBuildOptions: configuration.mac },
      {},
    );
    assert.deepEqual([...map.keys()], [value]);
    assert.deepEqual(map.get(value), ['dmg', 'zip']);
  }
});

test('missing compatible distribution targets fail explicitly', () => {
  assert.throws(
    () =>
      packagingArguments('darwin', 'x64', false, {
        mac: { target: [{ target: 'dmg', arch: ['arm64'] }] },
      }),
    /configured.*target/i,
  );
});
