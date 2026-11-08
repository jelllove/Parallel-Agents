// Passive reporter: never writes hook decisions, model context, prompts or transcripts.
const { connect } = require('node:net');
const endpoint = process.env.PA_ACTIVITY_ENDPOINT;
const token = process.env.PA_ACTIVITY_TOKEN;
if (!endpoint || !token) process.exit(0);
let input = '';
let socket;
const finish = () => { socket?.destroy(); process.exit(0); };
setTimeout(finish, 1200);
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);
process.stdin.on('error', finish);
process.stdin.on('data', (chunk) => {
  input += chunk.toString('utf8');
  if (Buffer.byteLength(input) > 1024 * 1024) finish();
});
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input);
    const data = {};
    for (const key of ['reason', 'status', 'recoverable', 'notification_type']) {
      const value = payload[key];
      if (typeof value === 'boolean' || (typeof value === 'string' && value.length < 80)) data[key] = value;
    }
    for (const key of ['agent_id', 'agentId', 'parent_agent_id', 'parentAgentId']) if (payload[key]) data[key] = true;
    const sessionId = payload.session_id ?? payload.sessionId;
    const event = process.argv[2] || payload.hook_event_name;
    if (typeof sessionId !== 'string' || typeof event !== 'string') return finish();
    socket = connect(endpoint, () => socket.end(JSON.stringify({ token, event, sessionId, data, ...(typeof payload.turn_id === 'string' ? { turnId: payload.turn_id } : {}) }) + '\n'));
    socket.on('error', finish);
    socket.on('close', finish);
  } catch { finish(); }
});
