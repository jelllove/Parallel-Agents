import type { TitleBarOverlayOptions } from 'electron';
import type { ThemeMode } from '../shared/types.ts';

export function titleBarOverlayFor(theme: ThemeMode): TitleBarOverlayOptions {
  const light = theme === 'light';
  return {
    color: light ? '#ececec' : '#2d2d30',
    symbolColor: light ? '#1f1f1f' : '#ffffff',
    height: 36,
  };
}
