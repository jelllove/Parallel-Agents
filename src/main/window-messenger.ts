import type { BrowserWindow, WebContents } from 'electron';

export function sendToWindow(
  win: BrowserWindow | null,
  ...args: Parameters<WebContents['send']>
): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send(...args);
}
