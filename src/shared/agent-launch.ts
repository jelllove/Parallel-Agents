import type { AgentId } from './types.ts';

export interface AgentLaunchOptions {
  approvalMode: string;
  model: string;
}

export type AgentLaunchSettings = Partial<Record<AgentId, AgentLaunchOptions>>;

export interface ApprovalMode {
  id: string;
  label: string;
  description: string;
  args: string[];
  risky: boolean;
}

const inherited: ApprovalMode = {
  id: 'default',
  label: 'Use CLI defaults',
  description:
    'No approval override. Your CLI configuration, remembered permissions and organization policies still apply.',
  args: [],
  risky: false,
};

function mode(
  id: string,
  label: string,
  description: string,
  args: string[],
  risky = false,
): ApprovalMode {
  return { id, label, description, args, risky };
}

export const AGENT_LAUNCH: Record<
  AgentId,
  {
    name: string;
    modes: ApprovalMode[];
    modelHint: string;
    modelExamples: string[];
    reference: string;
  }
> = {
  copilot: {
    name: 'GitHub Copilot',
    modes: [
      inherited,
      mode(
        'auto-tools',
        'Auto-approve tools',
        'Allows tool execution without approval prompts. Does not add all-path or all-URL access; CLI deny rules still apply.',
        ['--allow-all-tools'],
        true,
      ),
    ],
    modelHint:
      'Use /model inside Copilot to see models available to your CLI and subscription. Enter that model ID here, not a Claude alias.',
    modelExamples: [],
    reference:
      'https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference',
  },
  claude: {
    name: 'Claude Code',
    modes: [
      inherited,
      mode(
        'manual',
        'Normal permission prompts',
        'Starts in the default permission mode. Existing allow rules and managed policies still apply.',
        ['--permission-mode', 'default'],
      ),
      mode(
        'plan',
        'Plan mode',
        'Requests plan-mode behavior; review and switch modes in Claude when ready to edit.',
        ['--permission-mode', 'plan'],
      ),
      mode(
        'accept-edits',
        'Auto-accept edits',
        'Accepts file edits without prompting; other permission checks remain.',
        ['--permission-mode', 'acceptEdits'],
        true,
      ),
      mode(
        'auto',
        'Auto mode (CLI safety classifier)',
        'Uses Claude auto mode, not a blanket bypass. Requires a CLI version, model and account that support auto mode.',
        ['--permission-mode', 'auto'],
        true,
      ),
    ],
    modelHint:
      'Claude accepts aliases such as sonnet, opus and haiku, or a full model ID supported by your Claude setup.',
    modelExamples: ['sonnet', 'opus', 'haiku'],
    reference: 'https://code.claude.com/docs/en/cli-reference',
  },
  codex: {
    name: 'Codex',
    modes: [
      inherited,
      mode(
        'manual',
        'Approval for untrusted commands',
        'Requests approval for commands outside the trusted set; retains the workspace-write sandbox.',
        ['--ask-for-approval', 'untrusted', '--sandbox', 'workspace-write'],
      ),
      mode(
        'read-only',
        'Read-only sandbox',
        'Requests read-only sandboxing and on-request approval. Does not grant unrestricted filesystem access.',
        ['--ask-for-approval', 'on-request', '--sandbox', 'read-only'],
      ),
      mode(
        'auto',
        'No approval prompts (workspace sandbox)',
        'Never asks to escalate; commands outside the workspace sandbox can fail rather than obtaining broader access.',
        ['--ask-for-approval', 'never', '--sandbox', 'workspace-write'],
        true,
      ),
    ],
    modelHint:
      'Use /model in Codex for available models. Enter the Codex model ID; provider access depends on your CLI configuration.',
    modelExamples: [],
    reference: 'https://developers.openai.com/codex/cli/reference',
  },
  gemini: {
    name: 'Gemini CLI',
    modes: [
      inherited,
      mode(
        'manual',
        'Normal approval prompts',
        'Uses Gemini default approval mode. Configured policies still apply.',
        ['--approval-mode', 'default'],
      ),
      mode(
        'plan',
        'Plan mode',
        'Starts in Gemini plan approval mode; requires a CLI version supporting it.',
        ['--approval-mode', 'plan'],
      ),
      mode(
        'auto-edit',
        'Auto-approve edits',
        'Automatically approves edit tools; other actions remain subject to Gemini policies.',
        ['--approval-mode', 'auto_edit'],
        true,
      ),
      mode(
        'auto',
        'Auto-approve actions (YOLO)',
        'Allows actions without normal confirmation prompts. Not equivalent to Codex workspace sandboxing.',
        ['--approval-mode', 'yolo'],
        true,
      ),
    ],
    modelHint:
      'Use /model in Gemini CLI. Enter a Gemini-supported model ID or alias; do not use model names from another agent.',
    modelExamples: ['auto'],
    reference: 'https://geminicli.com/docs/cli/cli-reference/',
  },
  aider: {
    name: 'Aider',
    modes: [
      inherited,
      mode(
        'yes',
        'Always answer yes',
        'Answers yes to every Aider confirmation, including actions beyond file edits. Does not create a sandbox.',
        ['--yes-always'],
        true,
      ),
    ],
    modelHint:
      'Use /models <keyword> in Aider to find provider-qualified model IDs, such as provider/model. Aider uses its own provider credentials.',
    modelExamples: [],
    reference: 'https://aider.chat/docs/config/options.html',
  },
};

export function isLaunchAgent(value: unknown): value is AgentId {
  return typeof value === 'string' && Object.hasOwn(AGENT_LAUNCH, value);
}

export function validateLaunchOptions(agent: AgentId, value: unknown): AgentLaunchOptions {
  if (!isLaunchAgent(agent)) throw new Error('Choose a valid launch agent.');
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid agent launch options.');
  if (Object.keys(value).some((key) => !['approvalMode', 'model'].includes(key)))
    throw new Error('Unknown agent launch option field.');
  const options = value as Partial<AgentLaunchOptions>;
  if (
    typeof options.approvalMode !== 'string' ||
    !AGENT_LAUNCH[agent].modes.some((mode) => mode.id === options.approvalMode)
  )
    throw new Error(`Unsupported approval mode for ${AGENT_LAUNCH[agent].name}.`);
  if (typeof options.model !== 'string')
    throw new Error('Model must be a model ID or an empty string for CLI defaults.');
  const model = options.model.trim();
  if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,199}$/.test(model))
    throw new Error(
      'Model ID must be at most 200 safe characters (letters, digits, . _ : / @ + -), without spaces or shell syntax.',
    );
  return { approvalMode: options.approvalMode, model };
}

export function validateLaunchSettings(value: unknown): AgentLaunchSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid saved agent launch settings.');
  const result: AgentLaunchSettings = {};
  for (const [agent, options] of Object.entries(value)) {
    if (!isLaunchAgent(agent)) throw new Error(`Unknown launch agent: ${agent}.`);
    result[agent] = validateLaunchOptions(agent, options);
  }
  return result;
}

const commandPatterns: Record<AgentId, RegExp> = {
  claude: /^claude(?: --resume [a-zA-Z0-9_.:-]+| --continue)?$/,
  codex: /^codex(?: resume (?:--last|[a-zA-Z0-9_.:-]+))?$/,
  gemini: /^gemini(?: --resume [a-zA-Z0-9_.:-]+)?$/,
  aider: /^aider(?: --restore-chat-history)?$/,
  copilot: /^copilot(?: --resume=[a-zA-Z0-9_.:-]+| --continue)?$/,
};

export function commandAgent(command: string | undefined): AgentId | null {
  if (!command) return null;
  for (const agent of Object.keys(commandPatterns)) {
    if (isLaunchAgent(agent) && commandPatterns[agent].test(command)) return agent;
  }
  return null;
}

export function configureAgentCommand(
  agent: AgentId,
  command: string,
  options?: AgentLaunchOptions,
): string {
  if (commandAgent(command) !== agent)
    throw new Error('Launch options apply only to a managed start/resume command.');
  const validated = validateLaunchOptions(agent, options ?? { approvalMode: 'default', model: '' });
  const selected = AGENT_LAUNCH[agent].modes.find((mode) => mode.id === validated.approvalMode)!;
  return [command, ...selected.args, ...(validated.model ? ['--model', validated.model] : [])].join(
    ' ',
  );
}
