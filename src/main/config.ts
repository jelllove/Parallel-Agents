import { app } from 'electron';
import { join } from 'node:path';
import { createConfigStore } from './config-store.ts';

const store = createConfigStore(join(app.getPath('home'), '.claude', 'parallel-agents.json'));

export const {
  loadConfig,
  saveConfig,
  getAgentLayout,
  setAgentOrder,
  setAgentPinned,
  setProjectPinned,
  setProjectHidden,
  setLastAgent,
  getLastAgent,
  setProjectOrder,
  forgetProject,
  getLayout,
  setLayout,
  getSidebarTree,
  setSidebarTree,
  getTheme,
  setTheme,
  getConfirmOnCloseTab,
  setConfirmOnCloseTab,
  getTerminalMultilineEnter,
  setTerminalMultilineEnter,
  getTerminalCopyPaste,
  setTerminalCopyPaste,
} = store;
