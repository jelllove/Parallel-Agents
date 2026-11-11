export function localBranchDate(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

export function suggestedSessionBranch(title: string, date: string, suffix: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 42)
    .replace(/^-|-$/g, '');
  return `feat/${date}_${slug || `session-${suffix}`}`;
}
