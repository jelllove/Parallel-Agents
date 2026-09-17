import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

import { HELP, parseArgs, runMaintenance } from '../scripts/maintenance.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const entry = join(repository, 'scripts', 'maintenance.mjs');
const original = '# Fixture\r\n\r\n*   item\r\n';
const formatted = await prettier.format(original, {
  parser: 'markdown',
  endOfLine: 'lf',
  embeddedLanguageFormatting: 'off',
});
const fixtureCheck =
  "node -e \"require('node:assert/strict').equal(require('node:fs').readFileSync('README.md', 'utf8'), '# Fixture\\n\\n- item\\n')\"";
const success = () => ({ exitCode: 0, status: 'passed', outputBytes: 0, durationMs: 0 });
const failure = () => ({ exitCode: 7, status: 'failed', outputBytes: 0, durationMs: 0 });
const sha = (content) => createHash('sha256').update(content).digest('hex');

async function put(root, path, content) {
  const target = join(root, ...path.split('/'));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

function git(root, ...args) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
  );
  const result = spawnSync(
    'git',
    [
      '-c',
      'core.autocrlf=false',
      '-c',
      `core.hooksPath=${join(root, '.git', 'disabled-hooks')}`,
      '-c',
      'commit.gpgSign=false',
      '-c',
      'user.name=Maintenance Fixture',
      '-c',
      'user.email=maintenance@example.invalid',
      ...args,
    ],
    {
      cwd: root,
      env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, '.no-git-config') },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function fixture(t, files = {}) {
  const artifacts = join(repository, 'reports');
  await mkdir(artifacts, { recursive: true });
  const root = await mkdtemp(join(artifacts, 'maintenance-test-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  await put(root, '.gitignore', 'reports/\nignored/\n');
  await put(root, '.prettierignore', 'docs/excluded.md\n');
  await put(root, '.prettierrc.json', '{ "endOfLine": "lf", "printWidth": 100 }\n');
  await put(root, 'README.md', '# Fixture\n');
  await put(root, 'src/product.js', 'export const product = "unchanged";\n');
  await put(root, 'resources/product.bin', Buffer.from([0, 1, 2, 255]));
  await put(
    root,
    'package.json',
    JSON.stringify({
      private: true,
      scripts: { check: fixtureCheck },
    }),
  );
  for (const [path, content] of Object.entries(files)) await put(root, path, content);
  git(root, 'init', '--quiet', '--template=');
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', 'Fixture baseline');
  return root;
}

function normalized(receipt) {
  const result = structuredClone(receipt);
  delete result.timing;
  for (const validation of result.validation) delete validation.durationMs;
  return result;
}

test('inherited hook Git variables cannot redirect fixture mutations or maintenance into a caller index', async (t) => {
  const caller = await fixture(t);
  const callerIndexPath = join(caller, '.git', 'caller.index');
  const callerIndex = await readFile(join(caller, '.git', 'index'));
  await writeFile(callerIndexPath, callerIndex);
  await put(caller, 'README.md', '# Unrelated caller edits\n');
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toUpperCase().startsWith('GIT_')),
  );
  const clearGitVariables = () => {
    for (const key of Object.keys(process.env)) {
      if (key.toUpperCase().startsWith('GIT_')) delete process.env[key];
    }
  };
  try {
    clearGitVariables();
    Object.assign(process.env, {
      GIT_DIR: join(caller, '.git'),
      GIT_COMMON_DIR: join(caller, '.git'),
      GIT_WORK_TREE: caller,
      GIT_INDEX_FILE: callerIndexPath,
      GIT_OBJECT_DIRECTORY: join(caller, '.git', 'objects'),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: join(caller, '.git', 'objects'),
      GIT_CONFIG_PARAMETERS: 'invalid inherited hook configuration',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.worktree',
      GIT_CONFIG_VALUE_0: caller,
      GIT_PREFIX: 'caller-prefix/',
    });
    const environmentCheck =
      "node -e \"require('node:assert/strict').deepEqual(Object.keys(process.env).filter(k=>k.startsWith('GIT_')&&!['GIT_OPTIONAL_LOCKS','GIT_TERMINAL_PROMPT'].includes(k)),[])\"";
    const root = await fixture(t, {
      'README.md': original,
      'package.json': JSON.stringify({
        private: true,
        scripts: { check: `${fixtureCheck} && ${environmentCheck}` },
      }),
    });
    const result = await runMaintenance({ root, apply: true });
    assert.equal(result.exitCode, 0, JSON.stringify(result.receipt));
    assert.equal(result.receipt.validation[0].exitCode, 0);
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), formatted);
    assert.deepEqual(await readFile(callerIndexPath), callerIndex);
    assert.deepEqual(await readFile(join(caller, '.git', 'index')), callerIndex);
    assert.equal(await readFile(join(caller, 'README.md'), 'utf8'), '# Unrelated caller edits\n');
  } finally {
    clearGitVariables();
    Object.assign(process.env, inherited);
  }
});

test('clean check is a read-only no-op with versioned, deterministic evidence', async (t) => {
  const root = await fixture(t);
  const before = git(root, 'status', '--porcelain=v1', '--untracked-files=all');
  const first = await runMaintenance({ root });
  const second = await runMaintenance({ root });
  assert.equal(first.exitCode, 0);
  assert.equal(first.receipt.schemaVersion, 1);
  assert.equal(first.receipt.mode, 'check');
  assert.equal(first.receipt.status, 'clean');
  assert.deepEqual(first.receipt.changes, []);
  assert.deepEqual(first.receipt.validation, []);
  assert.deepEqual(normalized(first.receipt), normalized(second.receipt));
  assert.equal(git(root, 'status', '--porcelain=v1', '--untracked-files=all'), before);
  assert.ok(first.receipt.timing.durationMs >= 0);
  assert.ok(
    Date.parse(first.receipt.timing.finishedAt) >= Date.parse(first.receipt.timing.startedAt),
  );
  assert.equal(first.receipt.protection.policy, 'non-runtime-formatting-v1');
});

test('check reports real Prettier drift without changing exact bytes or running validation', async (t) => {
  const root = await fixture(t, { 'README.md': original });
  const result = await runMaintenance(
    { root },
    {
      validate: () => {
        assert.fail('check must not execute npm');
      },
    },
  );
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.status, 'changes-needed');
  assert.deepEqual(
    result.receipt.changes.map((change) => change.path),
    ['README.md'],
  );
  assert.equal(result.receipt.changes[0].beforeSha256, sha(original));
  assert.equal(result.receipt.changes[0].afterSha256, sha(formatted));
  assert.deepEqual(await readFile(join(root, 'README.md')), Buffer.from(original));
  assert.equal(result.receipt.repairPasses, 0);
});

test('dirty and untracked documents are inventoried by checks without rewriting either', async (t) => {
  const root = await fixture(t);
  await put(root, 'README.md', original);
  await put(root, 'docs/untracked.md', original);
  const before = git(root, 'status', '--porcelain=v1', '--untracked-files=all');
  const { receipt, exitCode } = await runMaintenance({ root });
  assert.equal(exitCode, 1);
  assert.deepEqual(
    receipt.changes.map((change) => change.path),
    ['README.md', 'docs/untracked.md'],
  );
  assert.equal(git(root, 'status', '--porcelain=v1', '--untracked-files=all'), before);
  assert.equal(await readFile(join(root, 'docs', 'untracked.md'), 'utf8'), original);
});

test('explicit apply performs one formatting pass, validates, and preserves product files', async (t) => {
  const root = await fixture(t, { 'README.md': original, 'AGENTS.md': original });
  const product = await readFile(join(root, 'src', 'product.js'));
  const resource = await readFile(join(root, 'resources', 'product.bin'));
  const manifest = await readFile(join(root, 'package.json'));
  let calls = 0;
  const { receipt, exitCode } = await runMaintenance(
    { root, apply: true },
    {
      validate: async () => {
        calls += 1;
        assert.equal(await readFile(join(root, 'README.md'), 'utf8'), formatted);
        return success();
      },
    },
  );
  assert.equal(exitCode, 0);
  assert.equal(receipt.status, 'applied');
  assert.equal(receipt.repairPasses, 1);
  assert.equal(calls, 1);
  assert.deepEqual(receipt.validation[0].command, ['npm', 'run', 'check']);
  assert.equal(receipt.validation[0].exitCode, 0);
  assert.deepEqual(receipt.protection.writtenPaths, ['AGENTS.md', 'README.md']);
  assert.equal(receipt.protection.beforeSha256, receipt.protection.afterSha256);
  assert.deepEqual(await readFile(join(root, 'src', 'product.js')), product);
  assert.deepEqual(await readFile(join(root, 'resources', 'product.bin')), resource);
  assert.deepEqual(await readFile(join(root, 'package.json')), manifest);
});

test('clean apply is a no-op, not an unearned claim that validation ran', async (t) => {
  const root = await fixture(t);
  const { receipt, exitCode } = await runMaintenance(
    { root, apply: true },
    { validate: () => assert.fail('no repair requires no validation') },
  );
  assert.equal(exitCode, 0);
  assert.equal(receipt.status, 'clean');
  assert.deepEqual(receipt.validation, []);
  assert.equal(receipt.repairPasses, 0);
});

test('apply uses the actual installed npm CLI with a real fixture check', async (t) => {
  const root = await fixture(t, { 'README.md': original });
  const { receipt, exitCode } = await runMaintenance({ root, apply: true });
  assert.equal(exitCode, 0, JSON.stringify(receipt));
  assert.equal(receipt.validation[0].status, 'passed');
  assert.equal(receipt.validation[0].exitCode, 0);
  assert.ok(receipt.validation[0].durationMs > 0);
});

test('hard policy cannot be widened to sources, resources, builds, history, or manifests', async (t) => {
  const denied = {
    'src/AGENTS.md': original,
    'resources/README.md': original,
    'scripts/README.md': original,
    'tests/README.md': original,
    'Hackathon/README.md': original,
    'docs/superpowers/plan.md': original,
    'docs/generated/generated.md': original,
    'docs/archive/old.md': original,
    'docs/picture.png': original,
    'docs/package.json': '{    "runtime":true}',
    '.github/action.js': 'const runtime=1',
    '.vscode/settings.json': '{    "runtime":true}',
    'electron.vite.config.ts': 'export default {}',
    'package-lock.json': '{    "lockfileVersion":3}',
    'unknown.md': original,
  };
  const root = await fixture(t, {
    ...denied,
    'docs/guide.md': original,
    '.github/PULL_REQUEST_TEMPLATE.md': original,
    '.github/workflows/validate.yml': 'name:   Validate\non: [push]\n',
    '.github/maintenance.json': JSON.stringify({ version: 1, include: ['**/*'] }),
  });
  const { receipt, exitCode } = await runMaintenance({ root, apply: true }, { validate: success });
  assert.equal(exitCode, 0, JSON.stringify(receipt));
  assert.deepEqual(receipt.protection.writtenPaths, [
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/workflows/validate.yml',
    'docs/guide.md',
  ]);
  for (const [path, content] of Object.entries(denied)) {
    assert.deepEqual(await readFile(join(root, ...path.split('/'))), Buffer.from(content), path);
  }
});

test('Git ignores, Prettier ignores, and narrowing policy exclusions are never candidates', async (t) => {
  const root = await fixture(t, {
    'docs/excluded.md': original,
    'docs/private.md': original,
    'docs/guide.md': original,
    '.github/maintenance.json': JSON.stringify({
      version: 1,
      include: ['docs/**'],
      exclude: ['docs/private.md'],
    }),
  });
  await put(root, 'ignored/AGENTS.md', original);
  await put(root, 'docs/generated.md', original);
  await put(root, '.gitignore', 'reports/\nignored/\ndocs/generated.md\n');
  const result = await runMaintenance({ root });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(
    result.receipt.changes.map((change) => change.path),
    ['docs/guide.md'],
  );
  assert.equal(await readFile(join(root, 'docs', 'private.md'), 'utf8'), original);
});

for (const apply of [false, true]) {
  test(`${apply ? 'apply' : 'check'} unions independent Prettier and Git exclusions despite opposing negations`, async (t) => {
    const root = await fixture(t, {
      'README.md': original,
      '.gitignore': 'reports/\n!docs/excluded.md\ndocs/git-only.md\n',
      '.prettierignore': 'docs/excluded.md\n!docs/git-only.md\n',
      'docs/excluded.md': original,
      'docs/git-only.md': original,
    });
    const prettierInfo = await prettier.getFileInfo(join(root, 'docs', 'excluded.md'), {
      ignorePath: join(root, '.prettierignore'),
      resolveConfig: false,
    });
    assert.equal(prettierInfo.ignored, true);
    const excludedBefore = await readFile(join(root, 'docs', 'excluded.md'));
    const gitOnlyBefore = await readFile(join(root, 'docs', 'git-only.md'));
    const result = await runMaintenance({ root, apply }, { validate: success });
    assert.equal(result.exitCode, apply ? 0 : 1, JSON.stringify(result.receipt));
    assert.deepEqual(
      result.receipt.changes.map((change) => change.path),
      ['README.md'],
    );
    assert.deepEqual(await readFile(join(root, 'docs', 'excluded.md')), excludedBefore);
    assert.deepEqual(await readFile(join(root, 'docs', 'git-only.md')), gitOnlyBefore);
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), apply ? formatted : original);
    assert.equal(result.receipt.validation.length, apply ? 1 : 0);
  });
}

test('Git negations cannot make Prettier-excluded binary documents readable candidates', async (t) => {
  const binary = Buffer.from([0, 255, 254, 0]);
  const root = await fixture(t, {
    'README.md': original,
    '.gitignore': 'reports/\n!docs/excluded.md\n',
    'docs/excluded.md': binary,
  });
  const result = await runMaintenance({ root, apply: true }, { validate: success });
  assert.equal(result.exitCode, 0, JSON.stringify(result.receipt));
  assert.deepEqual(
    result.receipt.changes.map((change) => change.path),
    ['README.md'],
  );
  assert.deepEqual(await readFile(join(root, 'docs', 'excluded.md')), binary);
});

test('independent ignore evaluation batches literal paths without traversing ignored trees', async (t) => {
  const metadata = Object.fromEntries(
    Array.from({ length: 200 }, (_, index) => [
      `metadata-${index}-${'x'.repeat(60)}.txt`,
      'Ignored metadata\n',
    ]),
  );
  const root = await fixture(t, {
    ...metadata,
    'README.md': original,
    '.gitignore': 'reports/\nignored/\n!docs/**\n!metadata-*.txt\n',
    '.prettierignore': 'metadata-*.txt\ndocs/\\[literal\\].md\nignored/\n',
    'docs/[literal].md': original,
    'docs/l.md': original,
    'ignored/nested/generated.md': original,
  });
  const result = await runMaintenance({ root });
  assert.equal(result.exitCode, 1, JSON.stringify(result.receipt));
  assert.deepEqual(
    result.receipt.changes.map((change) => change.path),
    ['README.md', 'docs/l.md'],
  );
  assert.ok(result.receipt.inventory.excludedPaths >= 201);
  assert.equal(await readFile(join(root, 'docs', '[literal].md'), 'utf8'), original);
  assert.equal(await readFile(join(root, 'ignored', 'nested', 'generated.md'), 'utf8'), original);
});

test('generated attributes, generated headers, and hidden data cannot become formatting targets', async (t) => {
  const generated = '<!-- Automatically generated. Do not edit. -->\n\n*   item\n';
  const root = await fixture(t, {
    '.gitattributes': 'docs/api.md linguist-generated=true\n',
    'docs/api.md': original,
    'docs/reference.md': generated,
    'docs/.private/note.md': original,
    'docs/guide.md': original,
  });
  const result = await runMaintenance({ root, apply: true }, { validate: success });
  assert.equal(result.exitCode, 0, JSON.stringify(result.receipt));
  assert.deepEqual(result.receipt.protection.writtenPaths, ['docs/guide.md']);
  assert.equal(await readFile(join(root, 'docs', 'api.md'), 'utf8'), original);
  assert.equal(await readFile(join(root, 'docs', 'reference.md'), 'utf8'), generated);
  assert.equal(await readFile(join(root, 'docs', '.private', 'note.md'), 'utf8'), original);
});

test('invalid policy and executable Prettier configuration fail closed', async (t) => {
  for (const files of [
    { '.github/maintenance.json': '{"version":999}' },
    { '.github/maintenance.json': '{"version":1,"allowDirty":true}' },
    { '.github/maintenance.json': '{"version":1,"include":["../**"]}' },
    { '.prettierrc.json': '{"plugins":["./unsafe-plugin.mjs"]}' },
    { '.prettierrc.cjs': 'throw new Error("must not execute");' },
  ]) {
    const root = await fixture(t, { 'README.md': original, ...files });
    const result = await runMaintenance({ root, apply: true }, { validate: success });
    assert.equal(result.exitCode, 2);
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), original);
    assert.deepEqual(result.receipt.protection.writtenPaths, []);
  }
});

test('dirty tracked, staged, and untracked work each refuse apply without resetting edits', async (t) => {
  for (const type of ['tracked', 'staged', 'untracked']) {
    const root = await fixture(t, { 'README.md': original });
    if (type === 'untracked') await put(root, 'new.txt', 'user work');
    else {
      await put(root, 'src/product.js', 'user work');
      if (type === 'staged') git(root, 'add', 'src/product.js');
    }
    const before = git(root, 'status', '--porcelain=v1', '--untracked-files=all');
    const result = await runMaintenance({ root, apply: true }, { validate: success });
    assert.equal(result.exitCode, 2);
    assert.equal(result.receipt.status, 'refused');
    assert.equal(result.receipt.errors[0].code, 'dirty-worktree');
    assert.equal(git(root, 'status', '--porcelain=v1', '--untracked-files=all'), before);
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), original);
  }
});

test('validation failure restores exact originals, including CRLF, and records failure', async (t) => {
  const root = await fixture(t, { 'README.md': original, 'docs/guide.md': original });
  const result = await runMaintenance({ root, apply: true }, { validate: failure });
  assert.equal(result.exitCode, 2);
  assert.equal(result.receipt.status, 'failed');
  assert.equal(result.receipt.validation[0].exitCode, 7);
  assert.equal(result.receipt.rollback.status, 'restored');
  assert.deepEqual(result.receipt.rollback.restoredPaths, ['README.md', 'docs/guide.md']);
  assert.deepEqual(result.receipt.rollback.conflictPaths, []);
  assert.deepEqual(await readFile(join(root, 'README.md')), Buffer.from(original));
  assert.equal(git(root, 'status', '--porcelain=v1', '--untracked-files=all'), '');
});

test('rollback preserves a third-party edit instead of overwriting it', async (t) => {
  const root = await fixture(t, { 'README.md': original, 'docs/guide.md': original });
  const result = await runMaintenance(
    { root, apply: true },
    {
      validate: async () => {
        await put(root, 'README.md', '# Concurrent edit\n');
        return failure();
      },
    },
  );
  assert.equal(result.exitCode, 2);
  assert.equal(result.receipt.status, 'rollback-conflict');
  assert.equal(result.receipt.rollback.status, 'conflict');
  assert.deepEqual(result.receipt.rollback.conflictPaths, ['README.md']);
  assert.deepEqual(result.receipt.rollback.restoredPaths, ['docs/guide.md']);
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), '# Concurrent edit\n');
  assert.equal(await readFile(join(root, 'docs', 'guide.md'), 'utf8'), original);
});

test('a concurrent edit cannot be disguised as successful validation', async (t) => {
  const root = await fixture(t, { 'README.md': original });
  const result = await runMaintenance(
    { root, apply: true },
    {
      validate: async () => {
        await put(root, 'README.md', '# Third party\n');
        return success();
      },
    },
  );
  assert.equal(result.exitCode, 2);
  assert.equal(result.receipt.status, 'rollback-conflict');
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), '# Third party\n');
});

test('concurrent changes before the repair pass prevent that write', async (t) => {
  const root = await fixture(t, { 'README.md': original });
  const result = await runMaintenance(
    { root, apply: true },
    {
      beforeWrite: async () => put(root, 'README.md', '# Third party\n'),
      validate: () => assert.fail('must not validate an aborted repair'),
    },
  );
  assert.equal(result.exitCode, 2);
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), '# Third party\n');
  assert.deepEqual(result.receipt.protection.writtenPaths, []);
});

test('protected runtime mutation by validation is detected, never reset by maintenance', async (t) => {
  const root = await fixture(t, { 'README.md': original });
  const result = await runMaintenance(
    { root, apply: true },
    {
      validate: async () => {
        await put(root, 'src/product.js', 'third-party runtime edit');
        return success();
      },
    },
  );
  assert.equal(result.exitCode, 2);
  assert.ok(result.receipt.errors.some((error) => error.code === 'protected-content-changed'));
  assert.notEqual(result.receipt.protection.beforeSha256, result.receipt.protection.afterSha256);
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), original);
  assert.equal(await readFile(join(root, 'src', 'product.js'), 'utf8'), 'third-party runtime edit');
});

test('new protected files and changed ignore metadata invalidate an otherwise green repair', async (t) => {
  for (const path of ['src/new-product.js', 'docs/.gitignore']) {
    const root = await fixture(t, { 'README.md': original });
    let validated = false;
    const result = await runMaintenance(
      { root, apply: true },
      {
        validate: async () => {
          validated = true;
          await put(root, path, 'third-party change');
          return success();
        },
      },
    );
    assert.ok(validated, JSON.stringify(result.receipt));
    assert.equal(result.exitCode, 2);
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), original);
    assert.equal(await readFile(join(root, ...path.split('/')), 'utf8'), 'third-party change');
  }
});

test('hard-linked candidates cannot rewrite a second filesystem location', async (t) => {
  const root = await fixture(t, { 'README.md': original });
  await link(join(root, 'README.md'), join(root, 'reports-link.md'));
  const result = await runMaintenance({ root });
  assert.equal(result.exitCode, 2);
  assert.ok(result.receipt.errors.some((error) => error.code === 'unsafe-path'));
  assert.equal(await readFile(join(root, 'reports-link.md'), 'utf8'), original);
});

test('symlinked documents and directory escapes are rejected before opening content', async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t, { 'README.md': original });
  const link = join(root, 'docs');
  await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  const result = await runMaintenance({ root });
  assert.equal(result.exitCode, 2);
  assert.ok(result.receipt.errors.some((error) => error.code === 'unsafe-path'));
  assert.equal(await readFile(join(outside, 'README.md'), 'utf8'), original);
});

test('symlinked output directories cannot redirect reports outside the checkout', async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await symlink(outside, join(root, 'reports'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await runMaintenance({ root, output: 'reports/maintenance/result.json' });
  assert.equal(result.exitCode, 2);
  assert.equal((await readdir(outside)).includes('maintenance'), false);
});

test('requested report and patch are new artifacts, and the real Git patch applies', async (t) => {
  const root = await fixture(t, { 'README.md': original, 'docs/space name.md': '*   other' });
  const output = 'reports/maintenance/run/result.json';
  const patch = 'reports/maintenance/run/proposal.patch';
  const result = await runMaintenance({ root, output, patch });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(JSON.parse(await readFile(join(root, output), 'utf8')), result.receipt);
  assert.match(await readFile(join(root, patch), 'utf8'), /diff --git/);
  git(root, 'apply', '--check', '--whitespace=nowarn', join(root, patch));
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), original);
});

test('existing output and patch files are preserved and block apply before repairs', async (t) => {
  for (const kind of ['output', 'patch']) {
    const root = await fixture(t, { 'README.md': original });
    const target = `reports/maintenance/existing.${kind === 'output' ? 'json' : 'patch'}`;
    await put(root, target, 'prior evidence');
    const result = await runMaintenance(
      { root, apply: true, [kind]: target },
      { validate: () => assert.fail('output conflict must fail before validation') },
    );
    assert.equal(result.exitCode, 2);
    assert.equal(await readFile(join(root, target), 'utf8'), 'prior evidence');
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), original);
  }
});

test('source-shaped, outside, traversing, and wrong-extension artifact targets are rejected', async (t) => {
  const root = await fixture(t, { 'README.md': original });
  for (const output of [
    'README.md',
    'src/report.json',
    '../result.json',
    'reports/maintenance/../../result.json',
    'reports/maintenance/result.mjs',
    'reports/maintenance/result.json:stream',
    join(root, 'reports', 'maintenance', 'absolute.json'),
  ]) {
    const result = await runMaintenance({ root, apply: true, output }, { validate: success });
    assert.equal(result.exitCode, 2, output);
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), original);
  }
});

test('concurrent output replacement cannot hide a failed report publication or lose user work', async (t) => {
  const root = await fixture(t, { 'README.md': original });
  const output = 'reports/maintenance/result.json';
  const result = await runMaintenance(
    { root, apply: true, output },
    {
      validate: async () => {
        await put(root, output, 'third-party report');
        return success();
      },
    },
  );
  assert.equal(result.exitCode, 2);
  assert.equal(await readFile(join(root, output), 'utf8'), 'third-party report');
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), original);
});

test('a changed patch artifact also prevents a successful receipt and preserves its replacement', async (t) => {
  const root = await fixture(t, { 'README.md': original });
  const patch = 'reports/maintenance/proposal.patch';
  const result = await runMaintenance(
    { root, apply: true, patch },
    {
      validate: async () => {
        await put(root, patch, 'third-party patch');
        return success();
      },
    },
  );
  assert.equal(result.exitCode, 2);
  assert.equal(await readFile(join(root, patch), 'utf8'), 'third-party patch');
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), original);
  assert.equal(result.receipt.artifacts.patch.status, 'conflict');
});

test('candidate count and byte budgets fail closed before any repair', async (t) => {
  for (const limits of [{ maxCandidates: 1 }, { maxFileBytes: 8 }, { maxCandidateBytes: 8 }]) {
    const root = await fixture(t, { 'README.md': original, 'AGENTS.md': original });
    const result = await runMaintenance({ root, apply: true, limits }, { validate: success });
    assert.equal(result.exitCode, 2);
    assert.equal(result.receipt.errors[0].code, 'limit-exceeded');
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), original);
    assert.deepEqual(result.receipt.protection.writtenPaths, []);
  }
});

test('binary and invalid YAML candidates fail explicitly without partial repairs', async (t) => {
  for (const files of [
    { 'docs/binary.md': Buffer.from([0, 255, 0, 1]) },
    { '.github/invalid.yml': 'broken: [\n' },
  ]) {
    const root = await fixture(t, { 'README.md': original, ...files });
    const result = await runMaintenance({ root, apply: true }, { validate: success });
    assert.equal(result.exitCode, 2);
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), original);
    assert.deepEqual(result.receipt.protection.writtenPaths, []);
  }
});

test('formatter timeout is an explicit bounded failure with no document mutations', async (t) => {
  const root = await fixture(t, { 'README.md': original });
  const result = await runMaintenance({
    root,
    apply: true,
    limits: { formattingTimeoutMs: 1 },
  });
  assert.equal(result.exitCode, 2);
  assert.ok(result.receipt.errors.some((error) => error.code === 'format-timeout'));
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), original);
  assert.deepEqual(result.receipt.validation, []);
});

test('rejected, invalid, and timed-out validation never appear successful or leak diagnostics', async (t) => {
  const secret = 'fixture-secret-not-for-receipts';
  for (const validate of [
    () => Promise.reject(new Error(secret)),
    () => undefined,
    () => new Promise(() => {}),
  ]) {
    const root = await fixture(t, { 'README.md': original });
    const result = await runMaintenance(
      { root, apply: true, limits: { validationTimeoutMs: 50 } },
      { validate },
    );
    assert.equal(result.exitCode, 2);
    assert.equal(result.receipt.rollback.status, 'restored');
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), original);
    assert.equal(JSON.stringify(result.receipt).includes(secret), false);
    assert.notEqual(result.receipt.validation[0].status, 'passed');
  }
});

test('CLI default and explicit dry-run remain read-only; unknown or contradictory flags fail', async (t) => {
  assert.deepEqual(parseArgs([]), {});
  assert.deepEqual(parseArgs(['--dry-run']), {});
  assert.deepEqual(parseArgs(['--apply']), { apply: true });
  for (const args of [
    ['--apply', '--dry-run'],
    ['--output'],
    ['--output', '--apply'],
    ['--apply', '--apply'],
    ['--allow-dirty'],
    ['--build'],
  ]) {
    assert.throws(() => parseArgs(args));
  }
  assert.match(HELP, /--apply/);
  assert.match(HELP, /reports/);
  const root = await fixture(t, { 'README.md': original });
  const result = spawnSync(process.execPath, [entry, '--dry-run'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'changes-needed');
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), original);
});

test('invalid CLI arguments emit the same complete receipt schema and truthful requested mode', async (t) => {
  const root = await fixture(t);
  const result = spawnSync(process.execPath, [entry, '--apply', '--unknown'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true,
  });
  assert.equal(result.status, 2);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.mode, 'apply');
  assert.equal(receipt.status, 'failed');
  assert.deepEqual(receipt.changes, []);
  assert.deepEqual(receipt.protection.writtenPaths, []);
  assert.ok(receipt.timing.durationMs >= 0);
});
