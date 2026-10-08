import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import test from 'node:test';
import { downloadFetch } from '../scripts/fetch-downloads.mjs';

const execFileAsync = promisify(execFile);

async function server(t, listener, onConnect) {
  const instance = createServer(listener);
  if (onConnect) instance.on('connect', onConnect);
  await new Promise((resolve) => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    instance.closeAllConnections();
    instance.close();
  });
  return `http://127.0.0.1:${instance.address().port}`;
}

test('Got request timeouts are converted to real Fetch abort signals', async (t) => {
  const url = await server(t, () => {});
  const fetch = downloadFetch(globalThis.fetch);
  const start = Date.now();
  await assert.rejects(fetch(url, { timeout: { request: 50 } }), /timeout|aborted/i);
  assert.ok(Date.now() - start < 1000, 'The request timeout was not enforced');
});

test('an existing cancellation signal is preserved', async (t) => {
  const url = await server(t, () => {});
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    downloadFetch(globalThis.fetch)(url, { signal: controller.signal }),
    /aborted/i,
  );
});

test('packaging Fetch uses the configured environment proxy rather than connecting directly', async (t) => {
  let proxyRequests = 0;
  const proxy = await server(
    t,
    (_request, response) => {
      proxyRequests += 1;
      response.end('proxied-download');
    },
    (_request, socket) => {
      proxyRequests += 1;
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      socket.once('data', () => {
        socket.end(
          'HTTP/1.1 200 OK\r\nContent-Length: 16\r\nConnection: close\r\n\r\nproxied-download',
        );
      });
    },
  );
  const module = new URL('../scripts/fetch-downloads.mjs', import.meta.url).href;
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      '--use-env-proxy',
      '--import',
      module,
      '-e',
      'fetch("http://download.example.invalid/file", {timeout:{request:2000}}).then(r=>r.text()).then(console.log)',
    ],
    {
      timeout: 5000,
      env: {
        ...process.env,
        HTTP_PROXY: proxy,
        http_proxy: proxy,
        HTTPS_PROXY: proxy,
        https_proxy: proxy,
        NO_PROXY: '',
        no_proxy: '',
        NODE_USE_ENV_PROXY: '1',
      },
    },
  );
  assert.match(stdout, /proxied-download/);
  assert.equal(proxyRequests, 1);
});
