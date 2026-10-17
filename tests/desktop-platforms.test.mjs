import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolveShellLaunch } from '../src/main/shell-profiles.ts';
import { PtyManager } from '../src/main/pty-session-manager.ts';

test('a POSIX agent PTY uses a login shell, while Windows retains cmd', async () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    let launch;
    const manager = new PtyManager(
      (command, args, options) => {
        launch = { command, args, options };
        return { onData() {}, onExit() {}, kill() {} };
      },
      { platform, env: { SHELL: '/bin/zsh', PATH: '/usr/bin' } },
    );
    await manager.spawn('fixture', '.', 80, 24);
    assert.equal(launch.command, platform === 'win32' ? 'cmd.exe' : '/bin/zsh');
    assert.deepEqual(launch.args, platform === 'win32' ? [] : ['-l']);
    manager.killAll();
  }
});

test('POSIX agent PATH hints use colons even when tested on Windows', async () => {
  let environment;
  const manager = new PtyManager(
    (_command, _args, options) => {
      environment = options.env;
      return { onData() {}, onExit() {}, kill() {} };
    },
    { platform: 'linux', env: { PATH: '/usr/bin', SHELL: '/bin/bash' } },
  );
  await manager.spawn('fixture', '.', 80, 24, undefined, ['/opt/tools']);
  assert.equal(environment.PATH, '/opt/tools:/usr/bin');
  manager.killAll();
});

test('macOS without SHELL falls back to its system zsh', () => {
  assert.deepEqual(resolveShellLaunch('darwin', 'default', null), {
    command: '/bin/zsh',
    args: ['-l'],
  });
});

test('desktop packaging adds native Intel and archives without changing the Windows installer name', async () => {
  const { build } = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(build.npmRebuild, false);
  assert.deepEqual(build.win.target, [
    { target: 'nsis', arch: ['x64'] },
    { target: 'zip', arch: ['x64'] },
  ]);
  assert.equal(build.nsis.artifactName, 'Parallel-Agents-Setup-${version}.${ext}');
  assert.equal(build.win.artifactName, 'Parallel-Agents-${version}-win-${arch}.${ext}');
  assert.deepEqual(build.mac.target, [
    { target: 'dmg', arch: ['arm64', 'x64'] },
    { target: 'zip', arch: ['arm64', 'x64'] },
  ]);
  assert.deepEqual(build.linux.target, [
    { target: 'AppImage', arch: ['x64'] },
    { target: 'deb', arch: ['x64'] },
    { target: 'rpm', arch: ['x64'] },
    { target: 'tar.gz', arch: ['x64'] },
  ]);
  assert.match(build.mac.artifactName, /\$\{arch\}/);
  assert.match(build.linux.artifactName, /\$\{arch\}/);
  assert.equal(build.mac.identity, '-');
  assert.equal(build.mac.hardenedRuntime, false);
});

test('native workflows separate Mac architectures and pin the Linux verification distribution', async () => {
  for (const workflow of ['ci.yml', 'release.yml']) {
    const source = await readFile(
      new URL(`../.github/workflows/${workflow}`, import.meta.url),
      'utf8',
    );
    assert.match(source, /os: macos-15-intel/);
    assert.match(source, /os: macos-15\n/);
    assert.match(source, /os: ubuntu-24\.04/);
    assert.doesNotMatch(source, /os: ubuntu-latest/);
  }
  const release = await readFile(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8',
  );
  assert.match(release, /label: macOS-Intel/);
  assert.match(release, /release\/\*\.tar\.gz/);
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /CI_PLATFORM: \$\{\{ matrix\.platformLabel \}\}/);
});

test('release workflow installs RPM build tools and retains both Linux package formats', async () => {
  const source = await readFile(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8',
  );
  const setup = source.indexOf('name: Install Linux package build tools');
  const distribution = source.indexOf('name: Build and verify distribution packages on Linux');
  assert.ok(
    setup >= 0 && setup < distribution,
    'RPM tooling must exist before distribution builds',
  );
  assert.match(source.slice(setup, distribution), /if: runner\.os == 'Linux'/);
  assert.match(
    source.slice(setup, distribution),
    /sudo apt-get install --no-install-recommends -y rpm/,
  );
  assert.match(source, /release\/\*\.deb/);
  assert.match(source, /release\/\*\.rpm/);
});

test('POSIX initial agent commands preserve PATH hints even when a login profile resets PATH', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const writes = [];
  const manager = new PtyManager(
    () => ({ onData() {}, onExit() {}, kill() {}, write: (value) => writes.push(value) }),
    { platform: 'linux', env: { PATH: '/usr/bin', SHELL: '/bin/bash' } },
  );
  await manager.spawn('fixture', '.', 80, 24, 'claude --continue', ["/opt/user's tools"]);
  t.mock.timers.tick(250);
  assert.deepEqual(writes, [
    "/usr/bin/env 'PATH=/opt/user'\\''s tools:/usr/bin' claude --continue\r",
  ]);
  manager.killAll();
});

for (const [shell, assignment] of [
  ['/usr/bin/pwsh', "'PATH=/opt/user''s tools:/usr/bin'"],
  ['/usr/bin/nu', `"PATH=/opt/user's tools:/usr/bin"`],
]) {
  test(`PATH hints use the argument quoting of ${shell}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const writes = [];
    const manager = new PtyManager(
      () => ({ onData() {}, onExit() {}, kill() {}, write: (value) => writes.push(value) }),
      { platform: 'linux', env: { PATH: '/usr/bin', SHELL: shell } },
    );
    await manager.spawn('fixture', '.', 80, 24, 'copilot', ["/opt/user's tools"]);
    t.mock.timers.tick(250);
    assert.deepEqual(writes, [`/usr/bin/env ${assignment} copilot\r`]);
    manager.killAll();
  });
}

test('native workflows materialize lazy Electron downloads before configuring its sandbox helper', async () => {
  for (const workflow of ['ci.yml', 'release.yml']) {
    const source = await readFile(
      new URL(`../.github/workflows/${workflow}`, import.meta.url),
      'utf8',
    );
    const download = source.indexOf('name: Ensure Electron runtime is installed');
    const sandbox = source.indexOf('name: Prepare the disposable Electron sandbox helper');
    assert.ok(
      download >= 0 && download < sandbox,
      `${workflow} must download Electron before chmod`,
    );
    assert.match(source.slice(download, sandbox), /require\('electron'\)/);
  }
});
