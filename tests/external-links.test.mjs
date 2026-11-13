import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import test from 'node:test';
import { isExternalWebUrl, openExternalWebUrl } from '../src/main/external-links.ts';

const valid = [
  'https://example.invalid/repo/pull/4646',
  'http://localhost:3000/',
  'HTTPS://example.invalid/a?b=c#d',
];
const invalid = [
  undefined,
  null,
  {},
  '',
  'about:blank',
  'javascript:alert(1)',
  'data:text/html,test',
  'file:///C:/test.txt',
  'ms-windows-store://home',
  'vscode://file/test',
  'https://',
  'https://exa mple.invalid',
  'https://example.invalid/\npath',
];

test('external web policy preserves HTTP(S) URLs and rejects unsupported protocols before OS invocation', async () => {
  const opened = [];
  for (const value of valid) {
    assert.equal(isExternalWebUrl(value), true);
    await openExternalWebUrl(value, async (url) => {
      opened.push(url);
    });
  }
  for (const value of invalid) {
    assert.equal(isExternalWebUrl(value), false);
    await assert.rejects(
      openExternalWebUrl(value, async (url) => {
        opened.push(url);
      }),
      /Only HTTP and HTTPS/,
    );
  }
  assert.deepEqual(opened, valid);
  await assert.rejects(
    openExternalWebUrl(valid[0], async () => {
      throw new Error('No browser');
    }),
    /No browser/,
  );
});

test('shell openExternal IPC enforces the web policy in the main process', async () => {
  const require = createRequire(import.meta.url);
  const handlers = new Map();
  const opened = [];
  const { code } = await transform(
    await readFile(new URL('../src/main/ipc.ts', import.meta.url), 'utf8'),
    { loader: 'ts', format: 'cjs' },
  );
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (id) => {
      if (id === 'electron')
        return {
          ipcMain: { handle: (name, handler) => handlers.set(name, handler), on() {} },
          shell: {
            openExternal: async (url) => {
              opened.push(url);
            },
          },
        };
      if (id === './external-links.ts') return { openExternalWebUrl };
      if (id === './pty-manager.ts') return { ptyManager: { attachWindow() {} } };
      if (id === './git.ts') return { attachWindow() {} };
      if (id === './activity-service.ts')
        return { activityRuntime: { bridge: { subscribe: () => () => {} } } };
      if (id.startsWith('.')) return {};
      return require(id);
    },
    module,
    module.exports,
  );
  module.exports.registerIpc({ once() {} }, { subscribe: () => () => {} });
  const open = handlers.get('shell:openExternal');
  for (const url of invalid) await assert.rejects(open({}, url), /Only HTTP and HTTPS/);
  await open({}, valid[0]);
  assert.deepEqual(opened, [valid[0]]);
});
