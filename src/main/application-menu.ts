import type { MenuItemConstructorOptions } from 'electron';

export function hidesOnClose(platform: NodeJS.Platform): boolean {
  return platform !== 'linux';
}

export function applicationMenu(
  platform: NodeJS.Platform,
  quit: () => void,
): MenuItemConstructorOptions[] | null {
  if (platform === 'win32') return null;
  const quitItem: MenuItemConstructorOptions = {
    label: 'Quit Parallel Agents',
    accelerator: platform === 'darwin' ? 'Command+Q' : 'Ctrl+Q',
    click: quit,
  };
  const first: MenuItemConstructorOptions =
    platform === 'darwin'
      ? {
          label: 'Parallel Agents',
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            quitItem,
          ],
        }
      : { label: 'File', submenu: [quitItem] };
  return [first, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }];
}
