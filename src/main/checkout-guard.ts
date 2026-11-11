import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';

const active = new Set<{ path: string; exclusive: boolean }>();
function overlaps(left: string, right: string): boolean {
  const within = (base: string, path: string) => {
    const part = relative(base, path);
    return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`));
  };
  return within(left, right) || within(right, left);
}
export async function canonicalCheckout(path: string): Promise<string> {
  const canonical = await realpath(path);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}
export async function guardCheckout<T>(
  path: string,
  run: () => Promise<T>,
  exclusive = true,
): Promise<T> {
  const canonical = await canonicalCheckout(path);
  if (
    [...active].some((other) => (exclusive || other.exclusive) && overlaps(other.path, canonical))
  )
    throw new Error('Checkout is busy; retry after the current operation finishes.');
  const lease = { path: canonical, exclusive };
  active.add(lease);
  try {
    return await run();
  } finally {
    active.delete(lease);
  }
}
