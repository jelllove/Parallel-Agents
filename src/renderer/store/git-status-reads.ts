interface Slot<T> {
  promise: Promise<T>;
  dirty: boolean;
}
/** One read plus a trailing dirty read; a watcher burst cannot publish an older snapshot last. */
export function createGitStatusReads<T>(read: (path: string) => Promise<T>) {
  const pending = new Map<string, Slot<T>>();
  return (path: string): Promise<T> => {
    const existing = pending.get(path);
    if (existing) {
      existing.dirty = true;
      return existing.promise;
    }
    const slot: Slot<T> = { dirty: false, promise: read(path) };
    slot.promise = slot.promise
      .then(async (initial) => {
        let value = initial;
        while (slot.dirty) {
          slot.dirty = false;
          value = await read(path);
        }
        return value;
      })
      .finally(() => {
        if (pending.get(path) === slot) pending.delete(path);
      });
    pending.set(path, slot);
    return slot.promise;
  };
}
