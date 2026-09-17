import { once } from 'node:events';
import { TOOL_DEFINITIONS, validateArguments } from './tools.mjs';

const protocolVersion = '2025-06-18';
const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const success = (id, result) => ({ jsonrpc: '2.0', id, result });
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function createProtocol(tools) {
  let initialized = false;
  let ready = false;
  let busy = false;
  return async function handle(message) {
    if (
      !record(message) ||
      message.jsonrpc !== '2.0' ||
      typeof message.method !== 'string' ||
      (Object.hasOwn(message, 'id') &&
        typeof message.id !== 'string' &&
        !Number.isSafeInteger(message.id))
    ) {
      return error(null, -32600, 'Invalid JSON-RPC request.');
    }
    if (!Object.hasOwn(message, 'id')) {
      if (message.method === 'notifications/initialized' && initialized) ready = true;
      return null;
    }
    const { id, method } = message;
    if (method === 'initialize') {
      if (
        initialized ||
        !record(message.params) ||
        typeof message.params.protocolVersion !== 'string' ||
        !record(message.params.capabilities) ||
        !record(message.params.clientInfo) ||
        typeof message.params.clientInfo.name !== 'string' ||
        typeof message.params.clientInfo.version !== 'string'
      ) {
        return error(id, -32602, 'Invalid or repeated initialization.');
      }
      initialized = true;
      return success(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'parallel-agents-engineering', version: '1.0.0' },
        instructions:
          'Local trusted-checkout engineering only. No arbitrary commands, repairs, publishing, or provider access.',
      });
    }
    if (method === 'ping') return success(id, {});
    if (!ready) return error(id, -32002, 'Initialize the MCP session before calling tools.');
    if (method === 'tools/list') return success(id, { tools: TOOL_DEFINITIONS });
    if (method !== 'tools/call') return error(id, -32601, 'Method not found.');
    const params = message.params;
    try {
      if (
        !record(params) ||
        Object.keys(params).some((key) => !['name', 'arguments', '_meta'].includes(key))
      ) {
        throw new Error('Invalid tool call parameters.');
      }
      validateArguments(params.name, params.arguments ?? {});
    } catch (failure) {
      return error(id, -32602, failure.message);
    }
    if (busy)
      return error(
        id,
        -32001,
        'One bounded tool run is already active; no additional run was started.',
      );
    busy = true;
    try {
      if (typeof tools[params.name] !== 'function')
        throw new Error('Tool implementation is unavailable.');
      const result = await tools[params.name](params.arguments ?? {});
      if (!record(result) || typeof result.status !== 'string')
        throw new Error('Tool returned an invalid result.');
      const isError = !['passed', 'clean'].includes(result.status);
      return success(id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError,
      });
    } catch (failure) {
      return success(id, {
        content: [{ type: 'text', text: String(failure.message ?? 'Engineering tool failed.') }],
        isError: true,
      });
    } finally {
      busy = false;
    }
  };
}

export async function serve(input, output, handle) {
  input.setEncoding('utf8');
  let buffer = '';
  const write = async (message) => {
    if (message !== null && !output.write(JSON.stringify(message) + '\n')) {
      await once(output, 'drain');
    }
  };
  const parse = async (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      await write(error(null, -32700, 'Invalid JSON.'));
      return;
    }
    await write(await handle(message));
  };
  for await (const chunk of input) {
    buffer += chunk;
    let boundary;
    while ((boundary = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      if (Buffer.byteLength(line) > 65_536)
        throw new Error('MCP request exceeds the 64 KiB input limit.');
      await parse(line);
    }
    if (Buffer.byteLength(buffer) > 65_536)
      throw new Error('MCP request exceeds the 64 KiB input limit.');
  }
  if (buffer.trim()) await parse(buffer);
}
