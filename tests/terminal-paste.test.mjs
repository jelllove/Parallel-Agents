import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { agentHandlesImagePaste, formatPastedPaths } from '../src/shared/terminal-paste.ts';
import { resolveClipboardPaste } from '../src/main/clipboard-paste.ts';

const clipboard = ({ file = '', png = null } = {}) => ({
  readFilePath: () => file,
  readImagePng: () => png,
});

test('only Copilot reads clipboard images natively', () => {
  assert.equal(agentHandlesImagePaste('copilot'), true);
  for (const agent of ['claude', 'codex', 'gemini', 'aider']) {
    assert.equal(agentHandlesImagePaste(agent), false);
  }
});

test('pasted paths are quoted only when needed and end with a separator', () => {
  assert.equal(formatPastedPaths(['C:\\a\\b.png']), 'C:\\a\\b.png ');
  assert.equal(
    formatPastedPaths(['C:\\my docs\\x.png', 'C:\\y.txt']),
    '"C:\\my docs\\x.png" C:\\y.txt ',
  );
  assert.equal(formatPastedPaths([]), '');
});

test('clipboard paste prefers copied files, then saves images, then falls back to text', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pa-paste-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  assert.deepEqual(
    await resolveClipboardPaste(
      'claude',
      dir,
      clipboard({ file: 'C:\\f.txt', png: Buffer.from('x') }),
    ),
    { kind: 'paths', paths: ['C:\\f.txt'] },
  );

  const image = await resolveClipboardPaste('claude', dir, clipboard({ png: Buffer.from('png') }));
  assert.equal(image.kind, 'paths');
  assert.match(image.paths[0], /paste-.*\.png$/);
  assert.ok(image.paths[0].startsWith(dir));
  assert.equal(await readFile(image.paths[0], 'utf8'), 'png');

  assert.deepEqual(await resolveClipboardPaste('claude', dir, clipboard()), { kind: 'text' });
});

test('Copilot receives images natively instead of a saved file', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pa-paste-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.deepEqual(
    await resolveClipboardPaste('copilot', dir, clipboard({ png: Buffer.from('png') })),
    { kind: 'native' },
  );
  assert.deepEqual(await resolveClipboardPaste('copilot', dir, clipboard({ file: 'C:\\f.txt' })), {
    kind: 'paths',
    paths: ['C:\\f.txt'],
  });
});
