// Inert provider fixture: exercises the real observer script, never a live model.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  process.stdout.write('--settings --plugin-dir --dangerously-bypass-hook-trust\n');
  process.exit(0);
}
process.stdout.write(`SMOKE_AGENT\nSMOKE_AGENT_ARGS ${args.join(' ')}\n`);
const activityEventIndex = args.indexOf('--activity-event');
if (activityEventIndex >= 0) {
  const event = args[activityEventIndex + 1];
  if (!['UserPromptSubmit', 'PermissionRequest', 'Stop'].includes(event))
    throw new Error('Invalid synthetic activity event');
  const result = spawnSync(
    process.execPath,
    [join(process.env.PA_ACTIVITY_REPORTER_DIR, 'activity-reporter.cjs'), event],
    {
      input: JSON.stringify({
        session_id: args[args.indexOf('--resume') + 1],
        hook_event_name: event,
      }),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
    },
  );
  if (result.status !== 0 || result.stdout || result.stderr)
    throw new Error('Reporter did not remain observational');
  process.exit(0);
}
const settingsIndex = args.indexOf('--settings');
if (settingsIndex < 0) process.exit(0);
const config = JSON.parse(readFileSync(args[settingsIndex + 1], 'utf8'));
if (!config.hooks?.Stop) throw new Error('Fixture did not receive valid observational hooks');
const resume = args.indexOf('--resume');
const session_id = resume >= 0 ? args[resume + 1] : 'fixture-new-session';
const reporter = join(process.env.PA_ACTIVITY_REPORTER_DIR, 'activity-reporter.cjs');
for (const event of ['UserPromptSubmit', 'PermissionRequest', 'Stop']) {
  const result = spawnSync(process.execPath, [reporter, event], {
    input: JSON.stringify({ session_id, hook_event_name: event }),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
  });
  if (result.status !== 0 || result.stdout || result.stderr)
    throw new Error('Reporter did not remain observational');
}
