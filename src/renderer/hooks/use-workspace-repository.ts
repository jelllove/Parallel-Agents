import { useEffect, useState } from 'react';
import type { WorkspaceRepository } from '../../shared/workspace-repository';

export function useWorkspaceRepository(path: string) {
  const [result, setResult] = useState<{
    path: string;
    info?: WorkspaceRepository;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!path.trim()) return;
    let active = true;
    void window.api.workspace.repository(path).then(
      (info) => {
        if (active) setResult({ path, info });
      },
      (error) => {
        if (active)
          setResult({ path, error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [path]);
  return {
    info: result?.path === path ? result.info : undefined,
    error: result?.path === path ? result.error : undefined,
    loading: Boolean(path.trim() && result?.path !== path),
  };
}
