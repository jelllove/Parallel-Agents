import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { reporterCommand } from '../src/main/activity-hook-config.ts';

test('missing reporter runtime does not deny a tool or emit hook decisions', async () => {
  const command = reporterCommand(
    `${process.cwd()}/missing-runtime`,
    `${process.cwd()}/resources/activity-reporter.cjs`,
    'PermissionRequest',
    process.platform,
  );
  const result = await new Promise((resolve, reject) => {
    const child =
      process.platform === 'win32'
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
            windowsHide: true,
          })
        : spawn('/bin/sh', ['-c', command]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => (stdout += data));
    child.stderr.on('data', (data) => (stderr += data));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') reject(error);
    });
    child.stdin.end('{}');
  });
  assert.deepEqual(result, { code: 0, stdout: '', stderr: '' });
});

test('real platform hook command remains silent without a managed launch token', async () => {
  const command = reporterCommand(
    process.execPath,
    `${process.cwd()}/resources/activity-reporter.cjs`,
    'Stop',
    process.platform,
  );
  const result = await new Promise((resolve, reject) => {
    const processOptions = {
      env: { ...process.env, PA_ACTIVITY_TOKEN: '', PA_ACTIVITY_ENDPOINT: '' },
      windowsHide: true,
    };
    const child =
      process.platform === 'win32'
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], processOptions)
        : spawn('/bin/sh', ['-c', command], processOptions);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => (stdout += data));
    child.stderr.on('data', (data) => (stderr += data));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') reject(error);
    });
    child.stdin.end('{}');
  });
  assert.deepEqual(result, { code: 0, stdout: '', stderr: '' });
});
