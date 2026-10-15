import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  AGENT_LAUNCH,
  configureAgentCommand,
  commandAgent,
  validateLaunchOptions,
} from '../src/shared/agent-launch.ts';
import { prepareAgentLaunch } from '../src/main/agent-launcher.ts';
import { PreferencesStore } from '../src/main/preferences-store.ts';
import { startCommandFor, resumeCommandFor } from '../src/shared/agent-commands.ts';

for (const agent of ['copilot', 'claude', 'codex', 'gemini', 'aider']) {
  test(`${agent} default commands stay byte-for-byte compatible on start and resume`, () => {
    for (const command of [startCommandFor(agent), resumeCommandFor(agent, 'session-123')]) {
      assert.equal(commandAgent(command), agent);
      assert.equal(configureAgentCommand(agent, command), command);
    }
  });
}

for (const [agent, mode, flags] of [
  ['claude', 'manual', '--permission-mode default'],
  ['claude', 'accept-edits', '--permission-mode acceptEdits'],
  ['claude', 'auto', '--permission-mode auto'],
  ['claude', 'plan', '--permission-mode plan'],
  ['codex', 'manual', '--ask-for-approval untrusted --sandbox workspace-write'],
  ['codex', 'auto', '--ask-for-approval never --sandbox workspace-write'],
  ['codex', 'read-only', '--ask-for-approval on-request --sandbox read-only'],
  ['gemini', 'manual', '--approval-mode default'],
  ['gemini', 'auto-edit', '--approval-mode auto_edit'],
  ['gemini', 'auto', '--approval-mode yolo'],
  ['copilot', 'auto-tools', '--allow-all-tools'],
  ['aider', 'yes', '--yes-always'],
]) {
  test(`${agent}/${mode} uses provider-specific flags without shared unsafe switches`, () => {
    const command = configureAgentCommand(agent, startCommandFor(agent), {
      approvalMode: mode,
      model: '',
    });
    assert.equal(command, `${agent} ${flags}`);
    assert.doesNotMatch(
      command,
      /--allow-all(?:\s|$)|--allow-all-paths|--allow-all-urls|danger-full-access|dangerously-bypass/,
    );
    const resume = resumeCommandFor(agent, 'session-123');
    assert.equal(
      configureAgentCommand(agent, resume, { approvalMode: mode, model: 'provider/model-1' }),
      `${resume} ${flags} --model provider/model-1`,
    );
  });
}

test('only fixed managed agent commands are recognized; shells and custom commands are not rewritten', () => {
  for (const command of [
    undefined,
    '',
    'echo smoke',
    'claude --help',
    'copilot && echo injected',
    'bash',
  ]) {
    assert.equal(commandAgent(command), null);
  }
});

test('models remain provider-scoped and unsafe shell tokens are rejected on every platform', () => {
  assert.equal(
    validateLaunchOptions('claude', { approvalMode: 'manual', model: ' sonnet ' }).model,
    'sonnet',
  );
  for (const model of [
    'foo;echo hi',
    'x&whoami',
    '$(id)',
    '`id`',
    '%PATH%',
    '!name!',
    '--help',
    'foo\nbar',
    '"x"',
    'two models',
    'x'.repeat(201),
  ]) {
    assert.throws(
      () => validateLaunchOptions('copilot', { approvalMode: 'default', model }),
      /model/i,
    );
  }
  assert.throws(
    () => validateLaunchOptions('copilot', { approvalMode: 'accept-edits', model: '' }),
    /mode/i,
  );
  assert.throws(
    () => validateLaunchOptions('unknown', { approvalMode: 'default', model: '' }),
    /agent/i,
  );
  assert.throws(
    () =>
      validateLaunchOptions('codex', { approvalMode: 'manual', model: '', extraArgs: '--unsafe' }),
    /field/i,
  );
});

test('risky settings need explicit save acknowledgement and cannot leak between providers', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pa-launch-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'preferences.json');
  const store = new PreferencesStore(path);
  await assert.rejects(
    store.setAgentLaunchOptions('copilot', { approvalMode: 'auto-tools', model: 'copilot-model' }),
    /acknowledge/i,
  );
  await Promise.all([
    store.setAgentLaunchOptions(
      'copilot',
      { approvalMode: 'auto-tools', model: 'copilot-model' },
      true,
    ),
    store.setAgentLaunchOptions('claude', { approvalMode: 'plan', model: 'sonnet' }),
    store.setFontSize(19),
  ]);
  const data = await new PreferencesStore(path).read();
  assert.deepEqual(data.agentLaunchOptions.copilot, {
    approvalMode: 'auto-tools',
    model: 'copilot-model',
  });
  assert.deepEqual(data.agentLaunchOptions.claude, { approvalMode: 'plan', model: 'sonnet' });
  assert.equal(data.agentLaunchOptions.codex, undefined);
  assert.equal(data.fontSize, 19);
  const original = await readFile(path, 'utf8');
  await assert.rejects(
    store.setAgentLaunchOptions('claude', { approvalMode: 'yolo', model: '' }),
    /mode/i,
  );
  assert.equal(await readFile(path, 'utf8'), original);
});

test('legacy preferences default to unchanged CLI behavior; invalid saved modes fail without overwriting data', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pa-launch-legacy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'preferences.json');
  const legacy = { sessionNames: {}, fontSize: 14, projects: [] };
  await writeFile(path, JSON.stringify(legacy));
  assert.deepEqual((await new PreferencesStore(path).read()).agentLaunchOptions, {});
  const corrupt = JSON.stringify({
    ...legacy,
    agentLaunchOptions: { copilot: { approvalMode: 'yolo', model: '' } },
  });
  await writeFile(path, corrupt);
  await assert.rejects(new PreferencesStore(path).setFontSize(18), /mode/i);
  assert.equal(await readFile(path, 'utf8'), corrupt);
});

test('main launch seam loads exact provider settings before start/resume/restart', async () => {
  for (const command of ['codex', 'codex resume session-123', 'codex resume --last']) {
    const result = await prepareAgentLaunch(command, {
      load: async () => ({
        codex: { approvalMode: 'manual', model: 'custom-model' },
        copilot: { approvalMode: 'auto-tools', model: 'wrong-model' },
      }),
      confirm: async () =>
        assert.fail('manual launch should not need a reduced-approval confirmation'),
    });
    assert.equal(
      result,
      `${command} --ask-for-approval untrusted --sandbox workspace-write --model custom-model`,
    );
  }
});

test('every reduced-approval launch requires confirmation; cancellation returns no command', async () => {
  let prompts = 0;
  const probes = {
    load: async () => ({ copilot: { approvalMode: 'auto-tools', model: '' } }),
    confirm: async (agent, mode, command) => {
      prompts++;
      assert.equal(agent, 'copilot');
      assert.equal(mode.risky, true);
      assert.match(command, /--allow-all-tools/);
      return true;
    },
  };
  await prepareAgentLaunch('copilot', probes);
  await prepareAgentLaunch('copilot --resume=session-123', probes);
  assert.equal(prompts, 2);
  await assert.rejects(
    prepareAgentLaunch('copilot', { ...probes, confirm: async () => false }),
    /cancel/i,
  );
});

test('plain shells never load agent data and persistence read errors block managed launches explicitly', async () => {
  assert.equal(
    await prepareAgentLaunch('echo smoke', {
      load: () => assert.fail('not an agent'),
      confirm: () => assert.fail('not an agent'),
    }),
    'echo smoke',
  );
  await assert.rejects(
    prepareAgentLaunch('claude', {
      load: async () => {
        throw new Error('Malformed preferences');
      },
      confirm: async () => true,
    }),
    /Malformed preferences/,
  );
});

test('provider descriptions do not claim account model discovery or identical permission semantics', () => {
  assert.match(AGENT_LAUNCH.copilot.modelHint, /\/model/);
  assert.match(AGENT_LAUNCH.aider.modelHint, /\/models/);
  assert.notDeepEqual(AGENT_LAUNCH.codex.modes, AGENT_LAUNCH.claude.modes);
});
