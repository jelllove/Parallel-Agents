export function worktreeBranchName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[~^:?*[\]\\]+/g, '-');
}

export function defaultWorktreePath(repoPath: string, name: string): string {
  const leaf = name.trim().replace(/[\\/]+/g, '-');
  if (!repoPath || !leaf) return '';
  const separator = repoPath.includes('\\') ? '\\' : '/';
  const base = repoPath.replace(/[\\/]+$/, '');
  return `${base}.worktree${separator}${leaf}`;
}
