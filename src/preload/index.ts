import { contextBridge, ipcRenderer } from 'electron';
import type { Api, UpdateStatus } from '../shared/types';

const terminalData = new Map<string, Set<Parameters<Api['pty']['onData']>[0]>>();
const observers = new Set<Parameters<Api['pty']['onData']>[0]>();
ipcRenderer.on(
  'pty:data',
  (_event, key: string, data: string, packet?: { generation: string; sequence: number }) => {
    for (const listener of terminalData.get(key) ?? []) listener(key, data, packet);
    for (const observer of observers) observer(key, data, packet);
  },
);

const api: Api = {
  workspace: {
    getRecentFolders: () => ipcRenderer.invoke('workspace:getRecentFolders'),
    repository: (path) => ipcRenderer.invoke('workspace:repository', path),
    getMode: () => ipcRenderer.invoke('workspace:getMode'),
    setMode: (mode) => ipcRenderer.invoke('workspace:setMode', mode),
  },
  platform:
    process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux'
      ? process.platform
      : 'other',
  updates: {
    getStatus: () => ipcRenderer.invoke('updates:getStatus'),
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.invoke('updates:install'),
    onStatus: (cb) => {
      const fn = (_: unknown, status: UpdateStatus) => cb(status);
      ipcRenderer.on('updates:status', fn);
      return () => {
        ipcRenderer.off('updates:status', fn);
      };
    },
  },
  projects: {
    create: (options) => ipcRenderer.invoke('projects:create', options),
    list: (fresh) => ipcRenderer.invoke('projects:list', fresh),
    pin: (id, pinned) => ipcRenderer.invoke('projects:pin', id, pinned),
    hide: (id, hidden) => ipcRenderer.invoke('projects:hide', id, hidden),
    delete: (id) => ipcRenderer.invoke('projects:delete', id),
    deleteMissing: (ids) => ipcRenderer.invoke('projects:deleteMissing', ids),
    setOrder: (agent, ids) => ipcRenderer.invoke('projects:setOrder', agent, ids),
  },
  sessions: {
    previewDeletion: (targets) => ipcRenderer.invoke('sessions:previewDeletion', targets),
    deleteReviewed: (token, worktreeKeys) =>
      ipcRenderer.invoke('sessions:deleteReviewed', token, worktreeKeys),
    finishDeletion: (token) => ipcRenderer.invoke('sessions:finishDeletion', token),
    cancelDeletion: (token) => ipcRenderer.invoke('sessions:cancelDeletion', token),
    order: (projectId) => ipcRenderer.invoke('sessions:order', projectId),
    move: (projectId, from, to, placement) =>
      ipcRenderer.invoke('sessions:move', projectId, from, to, placement),
    promoteDraft: (projectId, launchId, sessionId) =>
      ipcRenderer.invoke('sessions:promoteDraft', projectId, launchId, sessionId),
    rename: (projectId, sessionId, title) =>
      ipcRenderer.invoke('sessions:rename', projectId, sessionId, title),
    listForProject: (projectId, fresh) =>
      ipcRenderer.invoke('sessions:listForProject', projectId, fresh),
    inspectManaged: (terminalKey, launchId) =>
      ipcRenderer.invoke('sessions:inspectManaged', terminalKey, launchId),
    delete: (projectId, sessionId) => ipcRenderer.invoke('sessions:delete', projectId, sessionId),
  },
  activity: {
    snapshot: () => ipcRenderer.invoke('activity:snapshot'),
    codexStatus: () => ipcRenderer.invoke('activity:codexStatus'),
    configureCodex: (install, digest) =>
      ipcRenderer.invoke('activity:configureCodex', install, digest),
    onChange: (callback) => {
      const listener = (
        _event: unknown,
        snapshot: Awaited<ReturnType<Api['activity']['snapshot']>>,
      ) => callback(snapshot);
      ipcRenderer.on('activity:changed', listener);
      return () => ipcRenderer.off('activity:changed', listener);
    },
  },
  pty: {
    spawn: (opts) => ipcRenderer.invoke('pty:spawn', opts),
    write: (projectId, data) => ipcRenderer.invoke('pty:write', projectId, data),
    resize: (projectId, cols, rows) => ipcRenderer.invoke('pty:resize', projectId, cols, rows),
    kill: (projectId) => ipcRenderer.invoke('pty:kill', projectId),
    acknowledge: (key, generation, sequence) =>
      ipcRenderer.send('pty:acknowledge', key, generation, sequence),
    onData: (cb, key) => {
      const listeners = key ? (terminalData.get(key) ?? new Set()) : observers;
      if (key) terminalData.set(key, listeners);
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
        if (key && !listeners.size) terminalData.delete(key);
      };
    },
    onExit: (cb) => {
      const fn = (_: unknown, projectId: string, code: number) => cb(projectId, code);
      ipcRenderer.on('pty:exit', fn);
      return () => ipcRenderer.off('pty:exit', fn);
    },
  },
  fs: {
    readDir: (path) => ipcRenderer.invoke('fs:readDir', path),
    createFile: (path) => ipcRenderer.invoke('fs:createFile', path),
    createDir: (path) => ipcRenderer.invoke('fs:createDir', path),
    rename: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
    copy: (src, dest) => ipcRenderer.invoke('fs:copy', src, dest),
    move: (src, dest) => ipcRenderer.invoke('fs:move', src, dest),
    trash: (path) => ipcRenderer.invoke('fs:trash', path),
    reveal: (path) => ipcRenderer.invoke('fs:reveal', path),
    openDefault: (path) => ipcRenderer.invoke('fs:openDefault', path),
  },
  dialog: {
    pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  },
  agents: {
    getLaunchSettings: () => ipcRenderer.invoke('agents:getLaunchSettings'),
    setLaunchOptions: (agent, options, acknowledged) =>
      ipcRenderer.invoke('agents:setLaunchOptions', agent, options, acknowledged),
    list: () => ipcRenderer.invoke('agents:list'),
    checkAll: () => ipcRenderer.invoke('agents:checkAll'),
  },
  config: {
    getAgentLayout: () => ipcRenderer.invoke('config:getAgentLayout'),
    setAgentOrder: (ids) => ipcRenderer.invoke('config:setAgentOrder', ids),
    setAgentPinned: (agent, pinned) => ipcRenderer.invoke('config:setAgentPinned', agent, pinned),
    getFontSize: () => ipcRenderer.invoke('config:getFontSize'),
    setFontSize: (size) => ipcRenderer.invoke('config:setFontSize', size),
    getFontFamily: () => ipcRenderer.invoke('config:getFontFamily'),
    setFontFamily: (fontFamily) => ipcRenderer.invoke('config:setFontFamily', fontFamily),
    getFontBold: () => ipcRenderer.invoke('config:getFontBold'),
    setFontBold: (bold) => ipcRenderer.invoke('config:setFontBold', bold),
    getLastAgent: (projectId) => ipcRenderer.invoke('config:getLastAgent', projectId),
    setLastAgent: (projectId, agentId) =>
      ipcRenderer.invoke('config:setLastAgent', projectId, agentId),
    getLayout: () => ipcRenderer.invoke('config:getLayout'),
    setLayout: (layout) => ipcRenderer.invoke('config:setLayout', layout),
    getSidebarTree: () => ipcRenderer.invoke('config:getSidebarTree'),
    setSidebarTree: (tree) => ipcRenderer.invoke('config:setSidebarTree', tree),
    getTheme: () => ipcRenderer.invoke('config:getTheme'),
    setTheme: (theme) => ipcRenderer.invoke('config:setTheme', theme),
    getConfirmOnCloseTab: () => ipcRenderer.invoke('config:getConfirmOnCloseTab'),
    setConfirmOnCloseTab: (v) => ipcRenderer.invoke('config:setConfirmOnCloseTab', v),
    getTerminalMultilineEnter: () => ipcRenderer.invoke('config:getTerminalMultilineEnter'),
    setTerminalMultilineEnter: (v) => ipcRenderer.invoke('config:setTerminalMultilineEnter', v),
    getTerminalCopyPaste: () => ipcRenderer.invoke('config:getTerminalCopyPaste'),
    setTerminalCopyPaste: (v) => ipcRenderer.invoke('config:setTerminalCopyPaste', v),
  },
  git: {
    status: (repoPath) => ipcRenderer.invoke('git:status', repoPath),
    diff: (repoPath, filePath, staged) =>
      ipcRenderer.invoke('git:diff', repoPath, filePath, staged),
    stage: (repoPath, files) => ipcRenderer.invoke('git:stage', repoPath, files),
    unstage: (repoPath, files) => ipcRenderer.invoke('git:unstage', repoPath, files),
    discard: (repoPath, files) => ipcRenderer.invoke('git:discard', repoPath, files),
    commit: (repoPath, message) => ipcRenderer.invoke('git:commit', repoPath, message),
    watch: (repoPath) => ipcRenderer.invoke('git:watch', repoPath),
    onChanged: (cb) => {
      const fn = (_: unknown, repoPath: string) => cb(repoPath);
      ipcRenderer.on('git:changed', fn);
      return () => ipcRenderer.off('git:changed', fn);
    },
  },
  shell: {
    list: () => ipcRenderer.invoke('shell:list'),
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
