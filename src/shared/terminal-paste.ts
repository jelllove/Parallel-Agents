import type { AgentId } from './types';

export type ClipboardPaste =
  { kind: 'text' } | { kind: 'native' } | { kind: 'paths'; paths: string[] };

const NATIVE_IMAGE_PASTE: ReadonlySet<AgentId> = new Set(['copilot']);

export function agentHandlesImagePaste(agent: AgentId): boolean {
  return NATIVE_IMAGE_PASTE.has(agent);
}

export function formatPastedPaths(paths: string[]): string {
  if (paths.length === 0) return '';
  return `${paths.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' ')} `;
}
