import { AsyncLocalStorage } from 'node:async_hooks';

interface HistoryRead {
  fresh: boolean;
  shared: Map<string, Promise<unknown>>;
}
// Request-scoped provider indexes are shared within one inventory cycle, never across mutations.
const context = new AsyncLocalStorage<HistoryRead>();
export const freshHistoryRead = () => context.getStore()?.fresh === true;
export function withFreshHistory<T>(read: () => T): T {
  return context.getStore()?.fresh ? read() : context.run({ fresh: true, shared: new Map() }, read);
}
export function withHistoryRead<T>(read: () => T): T {
  return context.getStore() ? read() : context.run({ fresh: false, shared: new Map() }, read);
}
export function shareHistoryRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const scope = context.getStore();
  if (!scope) return read();
  let pending = scope.shared.get(key);
  if (!pending) {
    pending = read();
    scope.shared.set(key, pending);
  }
  return pending as Promise<T>;
}
