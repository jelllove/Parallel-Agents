import { stat } from 'node:fs/promises';

export async function fileSignature(path: string): Promise<string> {
  const info = await stat(path, { bigint: true });
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
}

/** Bounded decoded metadata only; callers still enumerate files and validate mutation identities. */
export function createMetadataCache(
  signature: (path: string) => Promise<string> = fileSignature,
  capacity = 2048,
) {
  const entries = new Map<string, { signature: string; value: unknown }>();
  const pending = new Map<string, Promise<unknown>>();
  let revision = 0;
  return {
    invalidate() {
      revision++;
      entries.clear();
      pending.clear();
    },
    async read<T>(path: string, load: () => Promise<T>, fresh = false): Promise<T> {
      if (fresh) return load();
      const generation = revision;
      const current = await signature(path);
      if (generation !== revision) return load();
      const cached = entries.get(path);
      if (cached?.signature === current) {
        entries.delete(path);
        entries.set(path, cached);
        return structuredClone(cached.value) as T;
      }
      const key = `${generation}\0${path}\0${current}`;
      let operation = pending.get(key);
      if (!operation) {
        operation = (async () => {
          const value = await load();
          if (
            value !== null &&
            value !== undefined &&
            generation === revision &&
            (await signature(path)) === current
          ) {
            if (generation !== revision) return value;
            entries.delete(path);
            entries.set(path, { signature: current, value: structuredClone(value) });
            if (entries.size > capacity) entries.delete(entries.keys().next().value!);
          }
          return value;
        })();
        pending.set(key, operation);
        void operation
          .finally(() => {
            if (pending.get(key) === operation) pending.delete(key);
          })
          .catch(() => {});
      }
      return structuredClone(await operation) as T;
    },
  };
}
