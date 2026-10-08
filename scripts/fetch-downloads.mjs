export function downloadFetch(fetch) {
  return (input, init = {}) => {
    const timeout = init.timeout?.request ?? 600000;
    if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('Invalid download timeout.');
    const options = { ...init };
    // Node's --use-env-proxy routes the same HTTP(S)_PROXY/NO_PROXY settings as the old Got agent.
    delete options.agent;
    delete options.timeout;
    const cancellation = options.signal ?? (input instanceof Request ? input.signal : undefined);
    const deadline = AbortSignal.timeout(timeout);
    options.signal = cancellation ? AbortSignal.any([cancellation, deadline]) : deadline;
    return fetch(input, options);
  };
}

if (process.execArgv.includes('--use-env-proxy')) {
  globalThis.fetch = downloadFetch(globalThis.fetch);
}
