import { appendFile, mkdir, stat, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface RuntimeFailure {
  event: 'renderer-gone' | 'child-gone';
  reason: string;
  exitCode: number;
  processType?: string;
}

/** Local, bounded process-exit metadata only: never record terminal output or provider requests. */
export function createRuntimeDiagnostics(path: string, version: string) {
  let pending = Promise.resolve();
  return (failure: RuntimeFailure): Promise<void> => {
    const entry = JSON.stringify({ time: new Date().toISOString(), version, ...failure }) + '\n';
    const operation = pending.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      try {
        if ((await stat(path)).size + Buffer.byteLength(entry) > 256 * 1024) {
          await unlink(`${path}.previous`).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          });
          await rename(path, `${path}.previous`);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await appendFile(path, entry, { encoding: 'utf8', mode: 0o600 });
    });
    pending = operation.catch(() => {});
    return operation;
  };
}
