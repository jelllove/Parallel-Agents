import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const sessionsUrl = new URL('../src/main/sessions.ts', import.meta.url).href;
const startTime = '2024-01-02T03:04:05.000Z';
const userTime = '2024-02-03T04:05:06.000Z';
const fileTime = new Date('2024-03-04T05:06:07.000Z');

async function fixture(t) {
  const root = join(process.cwd(), `.session-fixture-${randomUUID()}`);
  await mkdir(root);
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return root;
}

function jsonl(...records) {
  return records.map((record) => JSON.stringify(record)).join('\n');
}

async function writeLog(root, agent, id, content) {
  const parts =
    agent === 'claude'
      ? ['.claude', 'projects', 'workspace']
      : agent === 'gemini'
        ? ['.gemini', 'tmp', 'workspace', 'chats']
        : ['.copilot', 'session-state', id];
  const directory = join(root, ...parts);
  await mkdir(directory, { recursive: true });
  const file = join(directory, agent === 'copilot' ? 'events.jsonl' : `${id}.jsonl`);
  await writeFile(file, content);
  await utimes(file, fileTime, fileTime);
  return file;
}

function copilotHeader(projectPath, overrides = {}) {
  return {
    type: 'session.start',
    data: {
      sessionId: 'copilot-session',
      startTime,
      copilotVersion: '1.2.3',
      context: { gitRoot: projectPath, cwd: join(projectPath, 'nested'), branch: 'main' },
      ...overrides,
    },
  };
}

async function runInFixture(root, source) {
  return execFileAsync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--input-type=module',
      '--eval',
      `
        import assert from 'node:assert/strict';
        import { homedir } from 'node:os';
        import { listSessionsForProject } from ${JSON.stringify(sessionsUrl)};
        assert.equal(homedir(), process.cwd(), 'provider reads must stay inside the fixture');
        ${source}
      `,
    ],
    {
      cwd: root,
      env: { ...process.env, HOME: root, USERPROFILE: root },
      timeout: 10_000,
      windowsHide: true,
    },
  );
}

async function listSessions(root, projectId) {
  const { stdout } = await runInFixture(
    root,
    `console.log(JSON.stringify(await listSessionsForProject(${JSON.stringify(projectId)})));`,
  );
  return JSON.parse(stdout);
}

test('Claude preserves first non-sidechain messages, metadata, and descending date order', async (t) => {
  const root = await fixture(t);
  const cwd = join(root, 'project');
  await writeLog(
    root,
    'claude',
    'older',
    jsonl(
      { type: 'user', isSidechain: true, message: { content: 'Ignore sidechain' } },
      {
        type: 'user',
        message: { content: [{ type: 'image' }, { type: 'text', text: '  First \n request  ' }] },
        timestamp: startTime,
        cwd,
        gitBranch: 'main',
        version: '2.1',
      },
      { type: 'user', message: { content: 'Do not replace the title' }, timestamp: userTime },
    ),
  );
  await writeLog(
    root,
    'claude',
    'newer',
    jsonl({ type: 'user', message: { content: 'Newer request' }, timestamp: userTime }),
  );

  const sessions = await listSessions(root, 'claude:workspace');
  assert.deepEqual(
    sessions.map((session) => session.id),
    ['newer', 'older'],
  );
  assert.deepEqual(sessions[1], {
    id: 'older',
    projectId: 'claude:workspace',
    agent: 'claude',
    title: 'First request',
    timestamp: Date.parse(startTime),
    cwd,
    gitBranch: 'main',
    version: '2.1',
    modifiedAt: fileTime.getTime(),
  });
});

test('Copilot preserves Git-root grouping, initial user date, and context fields', async (t) => {
  const root = await fixture(t);
  const projectPath = join(root, 'project');
  await writeLog(
    root,
    'copilot',
    'directory-id',
    jsonl(
      copilotHeader(projectPath),
      { type: 'user.message', data: { content: '  Explain \n this code  ' }, timestamp: userTime },
      {
        type: 'user.message',
        data: { content: 'Later request' },
        timestamp: fileTime.toISOString(),
      },
    ),
  );
  await writeLog(root, 'copilot', 'other', jsonl(copilotHeader(join(root, 'other'))));

  assert.deepEqual(await listSessions(root, `copilot:${projectPath}`), [
    {
      id: 'copilot-session',
      projectId: `copilot:${projectPath}`,
      agent: 'copilot',
      title: 'Explain this code',
      timestamp: Date.parse(userTime),
      cwd: join(projectPath, 'nested'),
      gitBranch: 'main',
      version: '1.2.3',
      modifiedAt: fileTime.getTime(),
    },
  ]);
});

test('Gemini preserves its header and first textual user content', async (t) => {
  const root = await fixture(t);
  await writeLog(
    root,
    'gemini',
    'filename',
    jsonl(
      { sessionId: 'gemini-session', startTime },
      { type: 'model', content: [{ text: 'Ignore assistant' }] },
      { type: 'user', content: [{ inlineData: {} }, { text: '  Gemini \n request ' }] },
      { type: 'user', content: [{ text: 'Later request' }] },
    ),
  );

  assert.deepEqual(await listSessions(root, 'gemini:workspace'), [
    {
      id: 'gemini-session',
      projectId: 'gemini:workspace',
      agent: 'gemini',
      title: 'Gemini request',
      timestamp: Date.parse(startTime),
      cwd: null,
      gitBranch: null,
      version: null,
      modifiedAt: fileTime.getTime(),
    },
  ]);
});

test('blank, partial, malformed, null, scalar, and array records do not crash provider scans', async (t) => {
  const root = await fixture(t);
  const prefix = '\n \r\nnull\n42\nfalse\n"text"\n[]\n{"partial":\n';
  const projectPath = join(root, 'project');
  await writeLog(
    root,
    'claude',
    'session',
    prefix + jsonl({ type: 'user', message: { content: 'Claude' }, timestamp: startTime }),
  );
  await writeLog(
    root,
    'gemini',
    'session',
    prefix +
      jsonl(
        { sessionId: 'gemini-session', startTime },
        { type: 'user', content: [{ text: 'Gemini' }] },
      ),
  );
  await writeLog(
    root,
    'copilot',
    'session',
    prefix +
      jsonl(copilotHeader(projectPath), { type: 'user.message', data: { content: 'Copilot' } }),
  );

  for (const [projectId, title] of [
    ['claude:workspace', 'Claude'],
    ['gemini:workspace', 'Gemini'],
    [`copilot:${projectPath}`, 'Copilot'],
  ]) {
    assert.equal((await listSessions(root, projectId))[0]?.title, title);
  }
});

test('non-string optional Claude metadata is discarded rather than reaching the UI', async (t) => {
  const root = await fixture(t);
  await writeLog(
    root,
    'claude',
    'session',
    jsonl({
      type: 'user',
      message: { content: [{ type: 'text', text: 'Request' }] },
      timestamp: startTime,
      cwd: 123,
      gitBranch: { name: 'not a string' },
      version: ['not a string'],
    }),
  );

  const [session] = await listSessions(root, 'claude:workspace');
  assert.equal(session.cwd, null);
  assert.equal(session.gitBranch, null);
  assert.equal(session.version, null);
});

test('malformed nested Gemini text is skipped in favor of a valid textual part', async (t) => {
  const root = await fixture(t);
  await writeLog(
    root,
    'gemini',
    'session',
    jsonl(
      { sessionId: 'gemini-session', startTime },
      { type: 'user', content: [null, 123, { text: 42 }, { text: 'Valid request' }] },
    ),
  );

  assert.equal((await listSessions(root, 'gemini:workspace'))[0]?.title, 'Valid request');
});

test('invalid dates consistently fall back to file modification time for all providers', async (t) => {
  const root = await fixture(t);
  const projectPath = join(root, 'project');
  await writeLog(
    root,
    'claude',
    'session',
    jsonl({ type: 'user', message: { content: 'Claude' }, timestamp: 'invalid' }),
  );
  await writeLog(
    root,
    'gemini',
    'session',
    jsonl({ sessionId: 'gemini-session', startTime: 'invalid' }),
  );
  await writeLog(
    root,
    'copilot',
    'session',
    jsonl(copilotHeader(projectPath, { startTime: 'invalid' }), {
      type: 'user.message',
      data: { content: 'Copilot' },
      timestamp: 'invalid',
    }),
  );

  for (const projectId of ['claude:workspace', 'gemini:workspace', `copilot:${projectPath}`]) {
    const first = await listSessions(root, projectId);
    const second = await listSessions(root, projectId);
    assert.equal(first[0]?.timestamp, fileTime.getTime());
    assert.deepEqual(second, first);
  }
});

test('missing user messages retain provider fallback titles and timestamp precedence', async (t) => {
  const root = await fixture(t);
  const projectPath = join(root, 'project');
  await writeLog(root, 'claude', 'session', jsonl({ type: 'assistant' }) + '\n{"partial":');
  await writeLog(root, 'gemini', 'session', jsonl({ sessionId: 'gemini-session', startTime }));
  await writeLog(root, 'copilot', 'session', jsonl(copilotHeader(projectPath)));

  for (const [projectId, timestamp] of [
    ['claude:workspace', fileTime.getTime()],
    ['gemini:workspace', Date.parse(startTime)],
    [`copilot:${projectPath}`, Date.parse(startTime)],
  ]) {
    const [session] = await listSessions(root, projectId);
    assert.equal(session.title, '(no user message)');
    assert.equal(session.timestamp, timestamp);
  }
});

test('headerless Copilot and Gemini logs and missing provider roots produce no sessions', async (t) => {
  const root = await fixture(t);
  assert.deepEqual(await listSessions(root, 'claude:missing'), []);
  assert.deepEqual(await listSessions(root, 'gemini:missing'), []);
  assert.deepEqual(await listSessions(root, `copilot:${root}`), []);
  await writeLog(
    root,
    'gemini',
    'session',
    jsonl({ type: 'user', content: [{ text: 'Headerless' }] }),
  );
  await writeLog(
    root,
    'copilot',
    'session',
    jsonl({ type: 'user.message', data: { content: 'Headerless' } }),
  );
  assert.deepEqual(await listSessions(root, 'gemini:workspace'), []);
  assert.deepEqual(await listSessions(root, `copilot:${root}`), []);
});

test('unexpected directory-listing failures are surfaced instead of returning an empty list', async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, '.claude', 'projects'), { recursive: true });
  await writeFile(join(root, '.claude', 'projects', 'workspace'), 'not a provider directory');

  await assert.rejects(listSessions(root, 'claude:workspace'), /ENOTDIR/);
});

test('valid Unix-epoch dates are preserved instead of being replaced by file times', async (t) => {
  const root = await fixture(t);
  const projectPath = join(root, 'project');
  const epoch = '1970-01-01T00:00:00.000Z';
  await writeLog(
    root,
    'claude',
    'epoch',
    jsonl({ type: 'user', message: { content: 'Epoch' }, timestamp: epoch }),
  );
  await writeLog(root, 'gemini', 'epoch', jsonl({ sessionId: 'gemini-epoch', startTime: epoch }));
  await writeLog(root, 'copilot', 'epoch', jsonl(copilotHeader(projectPath, { startTime: epoch })));

  for (const projectId of ['claude:workspace', 'gemini:workspace', `copilot:${projectPath}`]) {
    assert.equal((await listSessions(root, projectId))[0]?.timestamp, 0);
  }
});

test('logs disappearing between discovery and opening are skipped without phantom sessions', async (t) => {
  const root = await fixture(t);
  await writeLog(
    root,
    'claude',
    'session',
    jsonl({ type: 'user', message: { content: 'Disappearing' }, timestamp: startTime }),
  );

  await runInFixture(
    root,
    `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const createReadStream = fs.createReadStream;
      fs.createReadStream = (path, options) => {
        fs.unlinkSync(path);
        return createReadStream(path, options);
      };
      syncBuiltinESMExports();
      assert.deepEqual(await listSessionsForProject('claude:workspace'), []);
    `,
  );
});

test('early metadata success closes real file streams without reading the full log tail', async (t) => {
  const root = await fixture(t);
  const projectPath = join(root, 'project');
  const tail = '\n{"type":"assistant","content":"unneeded"}'.repeat(20_000);
  await writeLog(
    root,
    'claude',
    'session',
    jsonl({ type: 'user', message: { content: 'Claude' } }) + tail,
  );
  await writeLog(
    root,
    'gemini',
    'session',
    jsonl(
      { sessionId: 'gemini-session', startTime },
      { type: 'user', content: [{ text: 'Gemini' }] },
    ) + tail,
  );
  await writeLog(
    root,
    'copilot',
    'session',
    jsonl(copilotHeader(projectPath), { type: 'user.message', data: { content: 'Copilot' } }) +
      tail,
  );

  await runInFixture(
    root,
    `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const streams = [];
      const createReadStream = fs.createReadStream;
      fs.createReadStream = (...args) => {
        const stream = createReadStream(...args);
        streams.push(stream);
        return stream;
      };
      syncBuiltinESMExports();
      for (const projectId of ${JSON.stringify(['claude:workspace', 'gemini:workspace', `copilot:${projectPath}`])}) {
        assert.equal((await listSessionsForProject(projectId)).length, 1);
        const stream = streams.at(-1);
        assert.equal(stream.destroyed, true, 'reader must destroy its input stream');
        assert.equal(stream.closed, true, 'reader must wait for its file descriptor to close');
        assert.ok(stream.bytesRead < ${tail.length}, 'reader must stop before the unneeded log tail');
      }
      assert.equal(streams.length, 3);
    `,
  );
});
