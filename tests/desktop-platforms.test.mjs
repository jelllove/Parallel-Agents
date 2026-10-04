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

test('desktop packaging defines Mac arm64 and Linux x64 without changing Windows', async () => {
  const { build } = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(build.npmRebuild, false);
  assert.deepEqual(build.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.deepEqual(build.mac.target, [
    { target: 'dmg', arch: ['arm64'] },
    { target: 'zip', arch: ['arm64'] },
  ]);
  assert.deepEqual(build.linux.target, [
    { target: 'AppImage', arch: ['x64'] },
    { target: 'deb', arch: ['x64'] },
  ]);
  assert.match(build.mac.artifactName, /\$\{arch\}/);
  assert.match(build.linux.artifactName, /\$\{arch\}/);
  assert.equal(build.mac.identity, '-');
  assert.equal(build.mac.hardenedRuntime, false);
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
