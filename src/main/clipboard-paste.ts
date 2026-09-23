import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { AgentId } from '../shared/types.ts';
import { agentHandlesImagePaste, type ClipboardPaste } from '../shared/terminal-paste.ts';

export interface ClipboardReader {
  readFilePath(): string;
  readImagePng(): Buffer | null;
}

export async function resolveClipboardPaste(
  agent: AgentId,
  pasteDir: string,
  clipboard: ClipboardReader,
): Promise<ClipboardPaste> {
  const file = clipboard.readFilePath();
  if (file) return { kind: 'paths', paths: [file] };

  const png = clipboard.readImagePng();
  if (!png) return { kind: 'text' };
  if (agentHandlesImagePaste(agent)) return { kind: 'native' };

  await mkdir(pasteDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(pasteDir, `paste-${stamp}-${randomUUID().slice(0, 8)}.png`);
  await writeFile(path, png);
  return { kind: 'paths', paths: [path] };
}
