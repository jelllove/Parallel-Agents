import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join, normalize } from 'node:path';
import test from 'node:test';

import * as metadata from '../src/main/session-metadata.ts';

const startTime = '2024-01-02T03:04:05.000Z';
const fileTime = new Date('2024-03-04T05:06:07.000Z');
const createReadStream = fs.createReadStream;
const projectPath = join(process.cwd(), 'fixture-project');

const providers = [
  {
    name: 'claude',
    read: metadata.readClaudeSessionMeta,
    records: (text, date = startTime) => [
      { type: 'user', message: { content: text }, timestamp: date },
    ],
  },
  {
    name: 'copilot',
    read: metadata.readCopilotSessionMeta,
    records: (text, date = startTime) => [
      {
        type: 'session.start',
        data: { sessionId: 'copilot-id', startTime: date, context: { gitRoot: projectPath } },
      },
      { type: 'user.message', data: { content: text } },
    ],
  },
  {
    name: 'gemini',
    read: metadata.readGeminiSessionMeta,
    records: (text, date = startTime) => [
      { sessionId: 'gemini-id', startTime: date },
      { type: 'user', content: [{ text }] },
    ],
  },
];

async function fixture(t) {
  const root = join(process.cwd(), `.session-metadata-fixture-${randomUUID()}`);
  await mkdir(root);
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeLog(root, name, content) {
  const file = join(root, `${name}.jsonl`);
  await writeFile(file, content);
  await utimes(file, fileTime, fileTime);
  return file;
}

function jsonl(records) {
  return records.map((record) => JSON.stringify(record)).join('\n');
}

function observeStreams(t, create = createReadStream) {
  const streams = [];
  t.mock.method(fs, 'createReadStream', (...args) => {
    const stream = create(...args);
    streams.push(stream);
    return stream;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return streams;
}

test('all readers skip malformed and non-object records, including an unfinished tail', async (t) => {
  const root = await fixture(t);
  for (const provider of providers) {
    const contents =
      '\n \r\nnull\r\n123\r\nfalse\r\n"text"\r\n[]\r\n{unfinished\r\n' +
      jsonl(provider.records('Valid request')) +
      '\n{"tail":';
    const file = await writeLog(root, provider.name, contents);
    assert.equal((await provider.read(file))?.title, 'Valid request');
  }
});

test('title whitespace normalization and the 80-character truncation boundary stay consistent', async (t) => {
  const root = await fixture(t);
  for (const provider of providers) {
    for (const [name, text, expected] of [
      ['whitespace', '  One\t two\nthree  ', 'One two three'],
      ['boundary', 'a'.repeat(80), 'a'.repeat(80)],
      ['truncated', 'a'.repeat(81), 'a'.repeat(80) + '…'],
    ]) {
      const file = await writeLog(root, `${provider.name}-${name}`, jsonl(provider.records(text)));
      assert.equal((await provider.read(file))?.title, expected);
    }
  }
});

test('missing and non-string dates use stable file times rather than coercion or the current clock', async (t) => {
  const root = await fixture(t);
  for (const provider of providers) {
    for (const [index, invalid] of [null, '', 0, false, {}, [], 'not-a-date'].entries()) {
      const file = await writeLog(
        root,
        `${provider.name}-${index}`,
        jsonl(provider.records('Request', invalid)),
      );
      assert.equal((await provider.read(file))?.timestamp, fileTime.getTime());
    }
    const records = provider.records('Missing date');
    delete records[0].timestamp;
    delete records[0].startTime;
    if (records[0].data) delete records[0].data.startTime;
    const file = await writeLog(root, `${provider.name}-missing`, jsonl(records));
    assert.equal((await provider.read(file))?.timestamp, fileTime.getTime());
  }
});

test('Claude accepts valid text blocks after malformed blocks and retains its empty-content fallback', async (t) => {
  const root = await fixture(t);
  const file = await writeLog(
    root,
    'blocks',
    jsonl([
      {
        type: 'user',
        message: {
          content: [
            null,
            [],
            'not a block',
            { type: 'text', text: 42 },
            { type: 'text', text: 'Text' },
          ],
        },
      },
    ]),
  );
  assert.equal((await metadata.readClaudeSessionMeta(file))?.title, 'Text');
  for (const [index, message] of [null, [], 123, { content: false }].entries()) {
    const empty = await writeLog(root, `empty-${index}`, jsonl([{ type: 'user', message }]));
    assert.equal((await metadata.readClaudeSessionMeta(empty))?.title, '(empty)');
  }
});

test('Copilot rejects malformed headers and guards every optional context field', async (t) => {
  const root = await fixture(t);
  const cwd = join(root, 'working', '..', 'project');
  const file = await writeLog(
    root,
    'copilot',
    jsonl([
      ...[null, [], 123, { context: null }, { context: [] }].map((data) => ({
        type: 'session.start',
        data,
      })),
      {
        type: 'session.start',
        data: {
          sessionId: [],
          startTime,
          copilotVersion: {},
          context: { gitRoot: 42, cwd, branch: false },
        },
      },
      { type: 'user.message', data: null },
      { type: 'user.message', data: { content: ['not text'] } },
      { type: 'user.message', data: { content: '  ' } },
      { type: 'user.message', data: { content: 'Valid request' }, timestamp: {} },
    ]),
  );

  assert.deepEqual(await metadata.readCopilotSessionMeta(file), {
    sessionId: null,
    projectPath: normalize(cwd),
    title: 'Valid request',
    timestamp: Date.parse(startTime),
    cwd,
    gitBranch: null,
    version: null,
  });
});

test('Gemini skips non-string session IDs and malformed textual content', async (t) => {
  const root = await fixture(t);
  const file = await writeLog(
    root,
    'gemini',
    jsonl([
      ...[null, [], 123, {}, false, ''].map((sessionId) => ({ sessionId })),
      { sessionId: 'valid-id', startTime },
      ...[null, {}, 123, 'not an array', [{ text: 42 }]].map((content) => ({
        type: 'user',
        content,
      })),
      { type: 'user', content: [null, 123, { text: [] }, { text: 'Valid request' }] },
    ]),
  );

  assert.deepEqual(await metadata.readGeminiSessionMeta(file), {
    sessionId: 'valid-id',
    title: 'Valid request',
    timestamp: Date.parse(startTime),
  });
});

test('Copilot and Gemini still recognize a user message that precedes the header', async (t) => {
  const root = await fixture(t);
  for (const provider of providers.slice(1)) {
    const [header, user] = provider.records('First request');
    const file = await writeLog(root, provider.name, jsonl([user, header]));
    assert.equal((await provider.read(file))?.title, 'First request');
  }
});

test('empty logs and missing files have distinct documented metadata fallbacks', async (t) => {
  const root = await fixture(t);
  const file = await writeLog(root, 'empty', '\n \r\n{"unfinished":');
  assert.deepEqual(await metadata.readClaudeSessionMeta(file), {
    title: '(no user message)',
    timestamp: fileTime.getTime(),
    cwd: null,
    gitBranch: null,
    version: null,
  });
  assert.equal(await metadata.readCopilotSessionMeta(file), null);
  assert.equal(await metadata.readGeminiSessionMeta(file), null);
  for (const provider of providers) {
    assert.equal(await provider.read(join(root, 'missing.jsonl')), null);
  }
});

test('unexpected file errors reject instead of looking like absent metadata', async (t) => {
  const root = await fixture(t);
  for (const provider of providers) {
    await assert.rejects(provider.read(root), (error) => ['EISDIR', 'EPERM'].includes(error.code));
  }
});

test('real stream read failures surface their original errors and close file descriptors', async (t) => {
  const root = await fixture(t);
  const error = Object.assign(new Error('Fixture read failure'), { code: 'EIO' });
  const streams = observeStreams(t, (path, options) =>
    createReadStream(path, {
      ...options,
      fs: {
        open: fs.open,
        close: fs.close,
        read: (_fd, _buffer, _offset, _length, _position, callback) => callback(error),
      },
    }),
  );
  for (const provider of providers) {
    const file = await writeLog(root, provider.name, jsonl(provider.records('Request')));
    await assert.rejects(provider.read(file), (caught) => caught === error);
    assert.equal(streams.at(-1).closed, true);
  }
});

test('I/O failures during early close cannot turn parsed metadata into silent success', async (t) => {
  const root = await fixture(t);
  const error = Object.assign(new Error('Fixture close failure'), { code: 'EIO' });
  const streams = observeStreams(t, (path, options) =>
    createReadStream(path, {
      ...options,
      fs: {
        open: fs.open,
        read: fs.read,
        close: (fd, callback) => fs.close(fd, (closeError) => callback(closeError ?? error)),
      },
    }),
  );
  for (const provider of providers) {
    const file = await writeLog(root, provider.name, jsonl(provider.records('Request')) + '\n');
    await assert.rejects(provider.read(file), (caught) => caught === error);
    assert.equal(streams.at(-1).closed, true);
  }
});

test('unexpected stream termination is rejected rather than being treated as end of file', async (t) => {
  const root = await fixture(t);
  const streams = observeStreams(t, (path, options) => {
    const stream = createReadStream(path, options);
    stream.once('open', () => stream.destroy());
    return stream;
  });
  for (const provider of providers) {
    const file = await writeLog(root, provider.name, jsonl(provider.records('Request')));
    await assert.rejects(provider.read(file), /closed before reading completed/);
    assert.equal(streams.at(-1).closed, true);
  }
});

test('shared Copilot header discovery stops at the header and closes its stream', async (t) => {
  const root = await fixture(t);
  const [header] = providers[1].records('Unused title');
  const tail = '\n{"type":"assistant"}'.repeat(20_000);
  const file = await writeLog(root, 'copilot', jsonl([header]) + tail);
  const streams = observeStreams(t);

  assert.equal(typeof metadata.readCopilotSessionStart, 'function');
  assert.deepEqual(await metadata.readCopilotSessionStart(file), {
    sessionId: 'copilot-id',
    projectPath,
    timestamp: Date.parse(startTime),
  });
  assert.equal(streams[0].closed, true);
  assert.ok(streams[0].bytesRead < tail.length);
});

test('shared Copilot header discovery is bounded to twenty nonblank records', async (t) => {
  const root = await fixture(t);
  const [header] = providers[1].records('Unused title');
  const prefix = '\n \r\nnull\n{"unfinished\n'.repeat(10);
  const file = await writeLog(root, 'too-late', prefix + jsonl([header]));

  assert.equal(typeof metadata.readCopilotSessionStart, 'function');
  assert.equal(await metadata.readCopilotSessionStart(file), null);

  const boundary = await writeLog(root, 'boundary', '\nnull\n'.repeat(19) + jsonl([header]));
  assert.equal((await metadata.readCopilotSessionStart(boundary))?.sessionId, 'copilot-id');
});
