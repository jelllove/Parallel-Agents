import { createTools } from './agent-tools/tools.mjs';
import { createProtocol, serve } from './agent-tools/protocol.mjs';

try {
  if (process.argv.length !== 2)
    throw new Error('Run from the trusted repository root: node scripts/mcp-server.mjs');
  const tools = await createTools(process.cwd());
  await serve(process.stdin, process.stdout, createProtocol(tools));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
