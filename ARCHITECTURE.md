# Parallel Agents — Architecture

Electron 应用，分三个进程角色：**main**（Node 端，IPC/PTY/Git）、**preload**（contextBridge 桥）、**renderer**（React + Zustand UI）。

- **Author**: jelllove ([jelllove@gmail.com](mailto:jelllove@gmail.com))
- **Stack**: Electron 32 · electron-vite · React 18 · TypeScript · Zustand · xterm.js · node-pty · Monaco · react-resizable-panels

---

## 1. High-Level Diagram

```
┌─────────────────────────── Renderer (Chromium) ───────────────────────────┐
│  React + Zustand store                                                    │
│  ┌──────────────┐  ┌────────────────────┐  ┌──────────────────────────┐   │
│  │ Sidebar      │  │ TerminalTabs       │  │ Explorer + GitPanel      │   │
│  │ ProjectList  │  │  xterm.js (1 per   │  │ DiffWindow (Monaco lazy) │   │
│  │ SessionList  │  │  tab) ←→ pty       │  │ LayoutPicker             │   │
│  │ AgentPicker  │  │                    │  │ ConfirmDialog            │   │
│  └──────────────┘  └────────────────────┘  └──────────────────────────┘   │
│                            │                                              │
│                       window.api (contextBridge)                          │
└────────────────────────────│──────────────────────────────────────────────┘
                             │  ipcRenderer.invoke / on
┌────────────────────────────▼──────────────────────────────────────────────┐
│                       Preload (sandboxed Node)                            │
│  src/preload/index.ts — 单纯把 ipcRenderer.invoke 包成 Api 表面             │
└────────────────────────────│──────────────────────────────────────────────┘
                             │  ipcMain.handle / webContents.send
┌────────────────────────────▼──────────────────────────────────────────────┐
│                         Main (Node, Electron)                             │
│  ┌──────────────┐  ┌────────────┐  ┌─────────┐  ┌─────────────┐           │
│  │ projects     │  │ sessions   │  │ git     │  │ pty-manager │           │
│  │ (scan ~/.    │  │ (parse     │  │ (CLI    │  │ (node-pty)  │           │
│  │  agent data) │  │  jsonl)    │  │ exec +  │  │             │           │
│  │              │  │            │  │ watch)  │  │             │           │
│  └──────────────┘  └────────────┘  └─────────┘  └─────────────┘           │
│  ┌──────────────┐  ┌────────────┐  ┌────────────────────────┐             │
│  │ fs-explorer  │  │ config     │  │ agent-providers        │             │
│  │ (CRUD +      │  │ (load/save │  │ (which / where)        │             │
│  │  shell ops)  │  │  JSON +    │  │                        │             │
│  │              │  │  migrate)  │  │                        │             │
│  └──────────────┘  └────────────┘  └────────────────────────┘             │
└───────────────────────────────────────────────────────────────────────────┘
                             │ fs / child_process
              ┌──────────────┴──────────────┐
        ~/.claude/projects/  ~/.codex/sessions/  ~/.gemini/tmp/  ~/.copilot/session-state/
        ~/.claude/parallel-agents.json (config)
        git CLI · Windows shell APIs
```

## 2. Source Tree

```
src/
├── main/                       Main process
│   ├── index.ts                BrowserWindow + registerIpc()
│   ├── ipc.ts                  ALL ipcMain.handle channels
│   ├── projects.ts             list / delete / sort projects
│   ├── sessions.ts             list / delete sessions (jsonl parsing)
│   ├── codex-storage.ts         scan / parse / delete Codex rollout files
│   ├── fs-explorer.ts          readDir + create/rename/copy/move/trash/reveal/openDefault
│   ├── git.ts                  status / diff / stage / unstage / discard / commit + watcher
│   ├── pty-manager.ts          node-pty wrapper, multiplexed by projectId
│   ├── agent-providers.ts      list agents + checkAll (which/where lookup)
│   └── config.ts               JSON load/save with migration helpers
│
├── preload/
│   └── index.ts                contextBridge.exposeInMainWorld('api', ...)
│
├── renderer/
│   ├── App.tsx                 Top-level layout (PanelGroup × order)
│   ├── store/
│   │   └── app-store.ts        Zustand store (single store)
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── ProjectList.tsx     drag/drop reorder + delete ctx-menu
│   │   ├── SessionList.tsx     delete × button
│   │   ├── AgentPicker.tsx
│   │   ├── AgentsBanner.tsx    missing-CLI banner
│   │   ├── TerminalTabs.tsx    tab bar + N × TerminalPane
│   │   ├── TerminalPane.tsx    xterm + fit/web-links addons
│   │   ├── Explorer.tsx        file tree + ctx menu + keybindings
│   │   ├── GitPanel.tsx        VSCode-style source control
│   │   ├── DiffWindow.tsx      Monaco DiffEditor (lazy)
│   │   ├── LayoutPicker.tsx    6-permutation popover
│   │   ├── ConfirmDialog.tsx   type-name destructive modal
│   │   ├── StatusBar.tsx       bottom bar + layout button
│   │   └── AboutDialog.tsx
│   ├── icons/agentIcons.ts
│   ├── assets/agents/          PNG/SVG per agent
│   └── styles/theme.css        single global stylesheet
│
└── shared/
    └── types.ts                Project/Session/AppConfig/Api 等共享类型
```

## 3. Process Boundaries

### 3.1 Main
- 入口 `src/main/index.ts` 创建唯一 `BrowserWindow`
- 调用 `registerIpc(win)` 一次性注册所有 `ipcMain.handle('xxx:yyy', ...)` 通道
- 把 `win` 传给 `ptyManager.attachWindow(win)` 和 `git.attachWindow(win)` 供它们 `webContents.send` 事件给 renderer

### 3.2 Preload
- contextIsolation 开启，只暴露 `window.api`（类型 `Api`，在 `shared/types.ts`）
- Preload 不写业务，只是 ipc 通道的 thin wrapper

### 3.3 Renderer
- React 18 + Zustand 单 store（`app-store.ts`），所有 UI 状态集中
- 唯一异步源：`window.api.*` —— 不直接碰 Node API

## 4. IPC Channels（按命名空间）

| Namespace | Channel | Direction | 说明 |
|---|---|---|---|
| `projects` | `list` / `pin` / `hide` / `delete` / `setOrder` | renderer → main | 项目元信息 CRUD |
| `sessions` | `listForProject` / `delete` | renderer → main | session jsonl |
| `pty` | `spawn` / `write` / `resize` / `kill` | renderer → main | 终端控制 |
| `pty` | `pty:data` / `pty:exit` | main → renderer | PTY 输出 / 退出 |
| `fs` | `readDir` / `createFile` / `createDir` / `rename` / `copy` / `move` / `trash` / `reveal` / `openDefault` | renderer → main | 文件操作 |
| `git` | `status` / `diff` / `stage` / `unstage` / `discard` / `commit` / `watch` | renderer → main | git 操作 |
| `git` | `git:changed` | main → renderer | 仓库变化广播 |
| `dialog` | `pickDirectory` | renderer → main | 系统目录选择器 |
| `agents` | `list` / `checkAll` | renderer → main | agent 元信息 + 安装检测 |
| `config` | `getLastAgent` / `setLastAgent` / `getLayout` / `setLayout` | renderer → main | 用户配置读写 |
| `shell` | `openExternal` | renderer → main | 系统打开 URL |
| `window` | `window:fullscreen` | main → renderer | 全屏状态变化 |

事件型（main → renderer）用 `webContents.send`，renderer 通过 `ipcRenderer.on` 订阅，preload 返回 unsubscribe 函数确保 cleanup。

## 5. State Management

### 5.1 Zustand Store (`app-store.ts`)

```ts
{
  // 数据
  projects, adhocProjects, sessions, agents, agentStatus,
  // 选择
  selectedProjectId, openTabs, activeTabId, tabAgent,
  // UI
  collapsedAgents, showHidden, clipboard, gitStatusByPath, layout,
  // 启动 actions
  loadProjects, loadAgents, checkAgents, loadLayout,
  // 项目操作
  pinProject, hideProject, deleteProject, reorderProjects,
  // session
  loadSessions, deleteSession,
  // tab
  openTabWithAgent, closeTab, setActiveTab,
  // git
  loadGitStatus, subscribeGitChanges,
  // layout
  setLayout, updateLayoutSizes(debounced),
}
```

只有一个 store；组件 `useAppStore((s) => s.field)` 按字段订阅。

### 5.2 Layout 持久化

- `App.tsx` 启动 `loadLayout()` → store 写入 `layout`
- `PanelGroup` 受控渲染：`defaultSize={layout.sizes[i]}`、`key={order.join('-')}` 顺序变了强制重挂
- 拖手柄触发 `onLayout(sizes)` → `updateLayoutSizes(sizes)` → store 即更新，**300ms debounce** 后写盘
- `LayoutPicker` 切顺序时 sizes 按 `pid` 重映射保持每栏比例不变

**关键**：不使用 `react-resizable-panels` 的 `autoSaveId`，避免它 localStorage 缓存覆盖我们 config 持久化。

## 6. Modules

### 6.1 projects.ts
- 扫 `~/.claude/projects/`、`~/.codex/sessions/`、`~/.gemini/tmp/` 和 `~/.copilot/session-state/`
- Codex 按 rollout `session_meta.payload.cwd` 归组，路径规范化后生成 `codex:<cwd>` project ID
- `dirName` 编码规则：`C--jelllove-Foo` → `C:\jelllove\Foo`（首字母作 drive，剩下 `-` → `\`）
- 排序：pinned 优先；同 agent 组内按 `projectOrder` 应用用户拖拽顺序
- `deleteProject(id)`：rm -rf agent 目录 + `forgetProject(id)`（清 pinned/hidden/lastAgent/projectOrder）

### 6.2 sessions.ts
- Claude: `<dirName>/<sessionId>.jsonl` —— 文件名就是 sessionId，直接 rm
- Codex: `sessions/YYYY/MM/DD/rollout-*.jsonl` —— 从 `session_meta` 读取 ID/cwd/version，标题优先取 `session_index.jsonl`
- Gemini: `<dirName>/chats/*.jsonl` —— 文件名 ≠ sessionId，遍历读 jsonl head 匹配 sessionId 字段后 rm

### 6.3 fs-explorer.ts
- 标准 `fs/promises` 包装 + Electron `shell` API
- `move()`：先 `rename`，捕获 `EXDEV` 跨设备错时回退到 `cp` + `rm`
- `trash()`：`shell.trashItem(path)` 走系统回收站
- `openDefault()`：`shell.openPath(path)` Windows 默认关联

### 6.4 git.ts
- 用 `child_process.execFile` 直接 shell out 到 `git`，不引 `simple-git`
- `getStatus`：`git -C <path> branch --show-current` + `git rev-list --left-right --count @{u}...HEAD` + `git status --porcelain=v1 -z` 解析（NUL 分隔，R/C 记录有 oldPath）
- `getDiff(repo, file, staged)`：staged 用 `HEAD:<file>` vs `:<file>`；working 用 `HEAD:<file>` vs 工作树
- **Watcher**：`fs.watch` 监听 `<repo>/.git/index` 和 `<repo>/.git/HEAD`，加 5s 兜底轮询；事件 debounce 800ms 后 `webContents.send('git:changed', repoPath)`
- 同时只为每个 repoPath 起一个 watcher（map 缓存）

### 6.5 pty-manager.ts
- node-pty 多路复用：`projectId → IPty` map
- `spawn(projectId, cwd, cols, rows, initialCommand?, extraPath?)` —— extraPath prepend 到 `PATH`，让 agent 找到 npm global bin
- 输出/退出走 `webContents.send('pty:data' | 'pty:exit', projectId, ...)`
- `kill(projectId)` 在 closeTab / deleteProject 时调用

### 6.6 agent-providers.ts
- `listAgents()` 返回固定的 5 个 agent 元信息
- `checkAllAgents()` 对每个 agent 跑 `where <bin>` 或 `which`，返回 `{available, path}`

### 6.7 config.ts
- `~/.claude/parallel-agents.json` 单文件
- `loadConfig()` 有内存 cache；首次加载跑 `migrate()` 补默认字段、把老 bare dirName 加 `claude:` 前缀
- 所有 setter 都先 load → merge → save

## 7. Critical Flows

### 7.1 Open a tab
```
User clicks project + agent
 └→ store.openTabWithAgent(projectId, agentId, cmd, extraPath)
     ├→ config.setLastAgent(...)             (持久化)
     ├→ openTabs += projectId, activeTabId = projectId
     └→ pendingInitialCommand[projectId] = { cmd, extraPath }
TerminalPane mount
 └→ store.consumePendingCommand(projectId)
 └→ pty.spawn({ projectId, cwd, cols, rows, initialCommand, extraPath })
Main: pty-manager creates IPty, pipes data → webContents.send('pty:data', ...)
Renderer: xterm.write(data)
```

### 7.2 Delete project（三次确认）
```
Right-click → ctx menu Delete...
 → ConfirmDialog 弹出
 → 输入 displayName 完全匹配 + 勾选 "I understand"
 → store.deleteProject(id)
     ├→ pty.kill(id) (若 tab 开着)
     ├→ projects.delete(id) IPC
     │   ├→ rm -rf agent 目录
     │   └→ forgetProject(id)  config 清理
     ├→ 清 openTabs/tabAgent/sessions/selectedProjectId
     └→ loadProjects() 刷新
```

### 7.3 Git status auto-refresh
```
selectProject(id)
 └→ loadGitStatus(realPath)
 └→ git.watch(realPath) IPC
     └→ main: git.watchRepo(repo) 启动 fs.watch + poll
File changes on disk
 └→ fs.watch fires / poll detects mtime change
 └→ debounce 800ms
 └→ webContents.send('git:changed', repoPath)
Renderer: subscribeGitChanges callback
 └→ loadGitStatus(repoPath) 重拉
```

### 7.4 Layout switch
```
User clicks ⊞ in StatusBar
 → LayoutPicker 弹层 (6 行)
 → User picks newOrder
 → reorderedSizes = newOrder.map(pid => currentSizes[oldOrder.indexOf(pid)])
 → store.setLayout({ order, sizes })
     ├→ set({ layout })  (React 重渲染)
     ├→ App.tsx 的 PanelGroup key 变 → 重挂 → defaultSize 重新生效
     └→ config.setLayout 立即写盘
```

## 8. Persistence Layout

`~/.claude/parallel-agents.json`：

```jsonc
{
  "pinned": ["claude:C--jelllove-foo"],
  "hidden": [],
  "lastAgentByProject": { "claude:C--jelllove-foo": "claude" },
  "projectOrder": {
    "claude": ["claude:C--jelllove-foo", "claude:C--jelllove-bar"],
    "gemini": []
  },
  "layout": {
    "order": ["sidebar", "middle", "right"],
    "sizes": [20, 58, 22]
  }
}
```

迁移见 `config.ts#migrate`：缺字段补默认；老 key 加 `claude:` 前缀。

## 9. Build & Release

- **dev**: `npm run dev` —— electron-vite dev server，main/preload/renderer 全部 hot reload
- **build**: `npm run build` —— 三个 vite 子构建到 `out/`
- **release**: `npm run release` =
  1. `electron-vite build`
  2. `electron-builder --dir` → `release/win-unpacked/`
  3. `node scripts/promote-latest.cjs` → `release/latest/`（用户固定路径）
- 原生依赖 node-pty 用 `@electron/rebuild` 在 release 阶段自动 rebuild 到 Electron ABI

## 10. Security / Sandboxing

- contextIsolation: 开
- nodeIntegration: 关
- Renderer 不能直接 require Node 模块；所有系统能力走 IPC
- 删除走系统回收站（非永久 rm）—— 给 user 一次反悔机会
- Project Delete 永久删除，靠输入名字 + 勾选硬验证防误删

## 11. Known Limitations

- 仅 Windows 路径编码（drive 首字母 + `-` → `\`）。macOS/Linux 需要扩展 `decodeDirName`。
- `react-resizable-panels` 在某些极端 size 组合下会自动夹紧，可能与持久化值轻微偏移（next onLayout 会把夹紧后的值回写）。
- Git watcher 在 Windows network drive 上 fs.watch 不稳，靠 5s poll 兜底。
- Monaco bundle ~1.2MB JS，lazy load 避免首屏拖慢；首次打开 diff 有 ~200ms 延迟。
