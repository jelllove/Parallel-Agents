export interface WorkspaceRef {
  value: string;
  label: string;
  kind: 'local' | 'remote' | 'tag';
}
export interface WorkspaceRepository {
  exists: boolean;
  isGit: boolean;
  root: string | null;
  hasHead: boolean;
  currentBranch: string | null;
  defaultRef: string;
  refs: WorkspaceRef[];
}
