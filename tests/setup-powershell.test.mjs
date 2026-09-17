import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const wrapper = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'setup.ps1');

test(
  'PowerShell setup delegates to the existing npm contract from any working directory',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'parallel-agents-setup-entry-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'scripts'));
    await copyFile(wrapper, join(root, 'scripts', 'setup.ps1'));
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'setup-entry-fixture',
        version: '1.0.0',
        scripts: { setup: 'node record.mjs' },
      }),
    );
    await writeFile(
      join(root, 'record.mjs'),
      `
import { writeFileSync } from 'node:fs';
writeFileSync('arguments.json', JSON.stringify(process.argv.slice(2)));
process.exit(Number(process.env.SETUP_FIXTURE_EXIT ?? 0));
`,
    );
    const args = [
      '-NoLogo',
      '-NoProfile',
      '-File',
      join(root, 'scripts', 'setup.ps1'),
      '--json',
      'two words',
    ];
    await execFileAsync('pwsh', args, { cwd: tmpdir(), windowsHide: true });
    assert.deepEqual(JSON.parse(await readFile(join(root, 'arguments.json'), 'utf8')), [
      '--json',
      'two words',
    ]);
    await assert.rejects(
      execFileAsync('pwsh', args, {
        cwd: tmpdir(),
        windowsHide: true,
        env: { ...process.env, SETUP_FIXTURE_EXIT: '7' },
      }),
      (error) => error.code === 7,
    );
  },
);
