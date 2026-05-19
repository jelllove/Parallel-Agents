import manifest from 'material-icon-theme/dist/material-icons.json';

interface IconDef {
  iconPath: string;
}

interface Manifest {
  iconDefinitions: Record<string, IconDef>;
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  languageIds: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded: Record<string, string>;
  file: string;
  folder: string;
  folderExpanded: string;
}

const m = manifest as unknown as Manifest;

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

function svgUrl(iconId: string): string | null {
  const def = m.iconDefinitions[iconId];
  if (!def) return null;
  const file = def.iconPath.split('/').pop();
  if (!file) return null;
  return `${BASE}/material-icons/${file}`;
}

export function fileIconUrl(name: string): string {
  const lower = name.toLowerCase();

  const byName = m.fileNames[lower];
  if (byName) {
    const url = svgUrl(byName);
    if (url) return url;
  }

  const parts = lower.split('.');
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.');
    const id = m.fileExtensions[ext] || m.languageIds[ext];
    if (id) {
      const url = svgUrl(id);
      if (url) return url;
    }
  }

  return svgUrl(m.file) ?? `${BASE}/material-icons/file.svg`;
}

export function folderIconUrl(name: string, expanded: boolean): string {
  const lower = name.toLowerCase();
  const table = expanded ? m.folderNamesExpanded : m.folderNames;
  const id = table[lower];
  if (id) {
    const url = svgUrl(id);
    if (url) return url;
  }
  const fallback = expanded ? m.folderExpanded : m.folder;
  return svgUrl(fallback) ?? `${BASE}/material-icons/folder.svg`;
}
