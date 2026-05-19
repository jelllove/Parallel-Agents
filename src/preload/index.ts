import { contextBridge, ipcRenderer } from 'electron';
import type { Api } from '../shared/types';

const api: Api = {
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    pin: (id, pinned) => ipcRenderer.invoke('projects:pin', id, pinned),
    hide: (id, hidden) => ipcRenderer.invoke('projects:hide', id, hidden),
  },
  sessions: {
    listForProject: (projectId) => ipcRenderer.invoke('sessions:listForProject', projectId),
  },
  pty: {
    spawn: (opts) => ipcRenderer.invoke('pty:spawn', opts),
    write: (projectId, data) => ipcRenderer.invoke('pty:write', projectId, data),
    resize: (projectId, cols, rows) => ipcRenderer.invoke('pty:resize', projectId, cols, rows),
    kill: (projectId) => ipcRenderer.invoke('pty:kill', projectId),
    onData: (cb) => {
      const fn = (_: unknown, projectId: string, data: string) => cb(projectId, data);
      ipcRenderer.on('pty:data', fn);
      return () => ipcRenderer.off('pty:data', fn);
    },
    onExit: (cb) => {
      const fn = (_: unknown, projectId: string, code: number) => cb(projectId, code);
      ipcRenderer.on('pty:exit', fn);
      return () => ipcRenderer.off('pty:exit', fn);
    },
  },
  fs: {
    readDir: (path) => ipcRenderer.invoke('fs:readDir', path),
  },
  dialog: {
    pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  },
  claude: {
    check: () => ipcRenderer.invoke('claude:check'),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },
  window: {
    onFullscreenChange: (cb) => {
      const fn = (_: unknown, on: boolean) => cb(on);
      ipcRenderer.on('window:fullscreen', fn);
      return () => ipcRenderer.off('window:fullscreen', fn);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);
