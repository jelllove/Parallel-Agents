interface Options {
  refresh(projectId: string): Promise<void>;
  failed(): void;
}

/** A bounded dirty set: one read per project, with one trailing refresh for bursts. */
export function createHistoryRefreshQueue({ refresh, failed }: Options) {
  const dirty = new Set<string>();
  let running = false;
  let closed = false;
  async function drain() {
    if (running || closed) return;
    running = true;
    try {
      while (dirty.size && !closed) {
        const projects = [...dirty];
        dirty.clear();
        for (const project of projects) {
          if (closed) break;
          try {
            await refresh(project);
          } catch {
            if (!closed) failed();
          }
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    request(projects: Iterable<string>) {
      if (closed) return;
      for (const project of projects) if (project) dirty.add(project);
      void drain();
    },
    close() {
      closed = true;
      dirty.clear();
    },
  };
}
