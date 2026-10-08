import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLoginPath } from '../src/main/login-path.ts';

test('Windows never executes a login shell or changes PATH', async () => {
  const env = { PATH: 'C:\\tools' };
  await loadLoginPath({
    platform: 'win32',
    env,
    run: () => assert.fail('must not launch a shell'),
  });
  assert.equal(env.PATH, 'C:\\tools');
});

for (const platform of ['darwin', 'linux']) {
  test(`${platform} imports login PATH without importing credentials or other variables`, async () => {
    const env = { PATH: '/usr/bin', SHELL: '/bin/zsh', HOME: '/fixture/home' };
    await loadLoginPath({
      platform,
      env,
      run: async (command, args, options) => {
        assert.equal(command, '/bin/zsh');
        assert.deepEqual(args.slice(0, 1), ['-ilc']);
        assert.equal(options.timeout, 5000);
        assert.equal(options.env, env);
        return {
          stdout:
            'startup noise\n__PARALLEL_AGENTS_PATH__/opt/homebrew/bin:/fixture/npm:/usr/bin\n',
        };
      },
    });
    assert.equal(env.PATH, '/usr/bin:/opt/homebrew/bin:/fixture/npm');
    assert.equal(env.HOME, '/fixture/home');
    assert.equal(Object.keys(env).length, 3);
  });
}

test('login PATH preserves inherited fixture/tool directories and removes duplicates', async () => {
  const env = { PATH: '/fixture/bin:/usr/bin', SHELL: '/bin/bash' };
  await loadLoginPath({
    platform: 'linux',
    env,
    run: async () => ({ stdout: '__PARALLEL_AGENTS_PATH__/usr/bin:/opt/npm\n' }),
  });
  assert.equal(env.PATH, '/fixture/bin:/usr/bin:/opt/npm');
});

test('login PATH cannot displace an inherited inert provider shim with a real provider', async () => {
  const env = { PATH: '/generated/smoke/bin:/usr/local/bin:/usr/bin', SHELL: '/bin/sh' };
  await loadLoginPath({
    platform: 'darwin',
    env,
    run: async () => ({ stdout: '__PARALLEL_AGENTS_PATH__/usr/local/bin:/usr/bin\n' }),
  });
  assert.equal(env.PATH.split(':')[0], '/generated/smoke/bin');
});

for (const failure of [
  new Error('timed out'),
  { stdout: 'startup noise only\n' },
  { stdout: '__PARALLEL_AGENTS_PATH__\n' },
]) {
  test(`login PATH failure is diagnosed and leaves inherited PATH intact: ${String(failure)}`, async () => {
    const env = { PATH: '/usr/bin', SHELL: '/bin/zsh' };
    const diagnostics = [];
    await loadLoginPath({
      platform: 'darwin',
      env,
      run: async () => {
        if (failure instanceof Error) throw failure;
        return failure;
      },
      diagnostic: (message) => diagnostics.push(message),
    });
    assert.equal(env.PATH, '/usr/bin');
    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0], /login.*PATH/i);
  });
}
