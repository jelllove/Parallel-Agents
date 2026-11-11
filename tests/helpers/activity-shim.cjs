// Inert provider fixture: exercises the real observer script, never a live model.
const { readFileSync, mkdirSync, writeFileSync, readdirSync, realpathSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  process.stdout.write('--settings --plugin-dir --dangerously-bypass-hook-trust\n');
  process.exit(0);
}
if (args.includes('--print')) {
  throw new Error('Automatic title requests have been removed.');
} else {
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
  const session_id = resume >= 0 ? args[resume + 1] : `fixture-new-${randomUUID()}`;
  if (resume < 0 && process.env.PA_FIXTURE_WRITE_NEW_HISTORY === '1') {
    const projectsRoot = join(process.env.HOME, '.claude', 'projects');
    const same = (left, right) => {
      try {
        left = realpathSync(left);
        right = realpathSync(right);
      } catch {
        return false;
      }
      return process.platform === 'win32'
        ? left.toLowerCase() === right.toLowerCase()
        : left === right;
    };
    const existing = readdirSync(projectsRoot).find((name) => {
      try {
        return readdirSync(join(projectsRoot, name))
          .filter((file) => file.endsWith('.jsonl'))
          .some((file) => {
            const line = readFileSync(join(projectsRoot, name, file), 'utf8')
              .split('\n')
              .find(Boolean);
            return line && same(JSON.parse(line).cwd, process.cwd());
          });
      } catch {
        return false;
      }
    });
    const directory = join(projectsRoot, existing ?? `fixture-${session_id}`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, `${session_id}.jsonl`),
      JSON.stringify({
        type: 'user',
        cwd: process.cwd(),
        timestamp: '2026-01-04T00:00:00Z',
        message: { content: '改进项目会话工作流' },
      }) + '\n',
    );
  }
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
}
