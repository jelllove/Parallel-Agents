function trackNativePtys() {
  const exits = new Set();
  const terminals = new Set();
  return {
    track(pty) {
      let resolveExit;
      const exited = new Promise((resolve) => {
        resolveExit = resolve;
      });
      exits.add(exited);
      terminals.add(pty);
      pty.onExit(() => {
        exits.delete(exited);
        terminals.delete(pty);
        resolveExit();
      });
      return pty;
    },
    terminate() {
      for (const pty of terminals) {
        try {
          pty.kill();
        } catch (error) {
          console.warn('Native fixture PTY kill failed', error);
        }
      }
    },
    async drain(timeoutMs = 10_000) {
      let timer;
      try {
        await Promise.race([
          Promise.all([...exits]),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Native PTY shutdown did not finish')),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
module.exports = { trackNativePtys };
