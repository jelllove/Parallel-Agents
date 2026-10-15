import {
  AGENT_LAUNCH,
  commandAgent,
  configureAgentCommand,
  validateLaunchOptions,
} from '../shared/agent-launch.ts';
import type { AgentLaunchSettings, ApprovalMode } from '../shared/agent-launch.ts';
import type { AgentId } from '../shared/types.ts';

export async function prepareAgentLaunch(
  command: string | undefined,
  probes: {
    load: () => Promise<AgentLaunchSettings>;
    confirm: (agent: AgentId, mode: ApprovalMode, command: string) => Promise<boolean>;
  },
): Promise<string | undefined> {
  const agent = commandAgent(command);
  if (!agent || !command) return command;
  const options = validateLaunchOptions(
    agent,
    (await probes.load())[agent] ?? { approvalMode: 'default', model: '' },
  );
  const result = configureAgentCommand(agent, command, options);
  const mode = AGENT_LAUNCH[agent].modes.find((mode) => mode.id === options.approvalMode)!;
  if (mode.risky && !(await probes.confirm(agent, mode, result)))
    throw new Error('Agent launch cancelled; no terminal was started.');
  return result;
}
