type KeyEvent = Pick<KeyboardEvent, 'type' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

export function terminalShortcut(
  event: KeyEvent,
  platform: string,
  options: { multiline: boolean; copyPaste: boolean; hasSelection: boolean },
): 'newline' | 'copy' | 'paste' | null {
  if (event.type !== 'keydown') return null;
  if (
    options.multiline &&
    event.key === 'Enter' &&
    (event.shiftKey || event.ctrlKey || (platform === 'darwin' && event.metaKey))
  ) {
    return 'newline';
  }
  const clipboardModifier =
    platform === 'darwin'
      ? event.metaKey && !event.ctrlKey && !event.shiftKey
      : platform === 'linux'
        ? event.ctrlKey && event.shiftKey && !event.metaKey
        : event.ctrlKey && !event.shiftKey && !event.metaKey;
  if (!options.copyPaste || !clipboardModifier || event.altKey) return null;
  if (
    event.key.toLowerCase() === 'c' &&
    (options.hasSelection || platform === 'darwin' || platform === 'linux')
  ) {
    return 'copy';
  }
  if (event.key.toLowerCase() === 'v') return 'paste';
  return null;
}
