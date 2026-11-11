import { nextSessionTab } from './store/tab-state.ts';

export function handleSessionCloseShortcut(
  event: KeyboardEvent,
  platform: string,
  openTabs: string[],
  activeTabId: string | null,
  requestClose: (id: string) => void,
  modalOpen: boolean,
): void {
  const modifier =
    platform === 'darwin' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (event.key.toLowerCase() !== 'w' || !modifier || event.altKey || event.shiftKey) return;
  event.preventDefault();
  event.stopPropagation();
  if (
    modalOpen ||
    event.repeat ||
    event.isComposing ||
    !activeTabId ||
    !openTabs.includes(activeTabId)
  )
    return;
  requestClose(activeTabId);
}

export function handleSessionTabShortcut(
  event: KeyboardEvent,
  openTabs: string[],
  activeTabId: string | null,
  activate: (id: string) => void,
  modalOpen: boolean,
): void {
  if (event.key !== 'Tab' || !event.ctrlKey || event.altKey || event.metaKey || modalOpen) return;
  const next = nextSessionTab(openTabs, activeTabId, event.shiftKey);
  if (!next) return;
  event.preventDefault();
  event.stopPropagation();
  activate(next);
}
