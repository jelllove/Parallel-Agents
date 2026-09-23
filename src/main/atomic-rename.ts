import { rename } from 'node:fs/promises';

export type RenameFile = (from: string, to: string) => Promise<void>;

// Windows briefly locks a just-replaced file while antivirus or indexing scans it (EPERM/EBUSY);
// EACCES is left alone because it usually means a real permission problem.
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EBUSY']);
const RENAME_RETRY_DELAYS_MS = [20, 50, 100, 200, 400];

export async function renameWithRetry(
  from: string,
  to: string,
  renameFile: RenameFile = rename,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await renameFile(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!TRANSIENT_RENAME_CODES.has(code) || attempt >= RENAME_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAYS_MS[attempt]));
    }
  }
}
