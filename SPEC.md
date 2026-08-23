# Parallel Agents — Product Spec

> 一个桌面应用，让多个 CLI coding agent（Claude Code / Codex / Gemini CLI 等）在同一个窗口里并行使用，不再每个 agent 开一个独立 terminal。

- **Author**: jelllove ([jelllove@gmail.com](mailto:jelllove@gmail.com))
- **Platform**: Windows (Electron, win-unpacked)
- **License**: MIT

---

## 1. Vision

日常用 Claude Code、Codex、Gemini CLI 这类终端式 AI agent 写代码时，痛点是：
- 每个 agent 各自起一个 terminal，桌面碎成 N 块
- 不同 agent 的会话历史、project 列表、工作目录散落在 `~/.claude/`、`~/.gemini/` 里，找不到
- 想对同一份代码同时用两个 agent 对比，要在 terminal 之间复制粘贴路径
- 切换 agent 时没人帮记"上一次这个 project 用的是哪个 CLI"

Parallel Agents 把这些都收到一个窗口里：左边管 project / session 历史，中间是带 tab 的终端，右边是文件浏览器和 Git 面板。

## 2. Target Users

- 单人开发者，同时订阅了多个 AI agent
- 经常在多个 project 之间切换
- 习惯 VSCode 风格的左中右三栏布局

## 3. Core Concepts

### Project
一个真实磁盘目录，对外 ID 是 `<agent>:<dirName>` 命名空间格式：
- `claude:C--jelllove-Foo` —— Claude Code 在 `~/.claude/projects/` 里能看到的目录
- `gemini:Foo` —— Gemini CLI 在 `~/.gemini/tmp/` 里的目录
- `adhoc:C:\some\path` —— 用户用 "Pick directory" 现场加的目录

### Session
某个 agent 在某 project 下的一次对话历史：
- Claude: `~/.claude/projects/<dirName>/<sessionId>.jsonl`
- Gemini: `~/.gemini/tmp/<dirName>/chats/<file>.jsonl`（filename ≠ sessionId，靠读 jsonl 头匹配）

### Tab
打开的一个 PTY shell。一个 tab 对应一个 projectId + 一个 agentId。可以同一个 project 开多个 tab 但每个 tab 只属于一个 agent。

### Agent
对一个 CLI 工具的抽象：claude / codex / gemini / aider / copilot。每个 agent 有：
- 显示名
- 图标资源
- 安装提示 + 安装 URL
- 启动命令
- 是否支持 resume session

## 4. Window Layout

三大栏 + 状态栏：

```
┌──────────────────────────────────────────────────────────┐
│ AgentsBanner (仅当某 agent 缺失时显示)                       │
├──────────┬───────────────────────────┬────────────────────┤
│ Sidebar  │ TerminalTabs              │ Explorer           │
│          │                           ├────────────────────┤
│ Projects │  ┌──────┬──────┐          │ Git Panel          │
│ Sessions │  │ Tab1 │ Tab2 │          │                    │
│          │  └──────┴──────┘          │                    │
│ About    │  xterm.js terminal        │                    │
├──────────┴───────────────────────────┴────────────────────┤
│ StatusBar                              [Layout ⊞]         │
└──────────────────────────────────────────────────────────┘
```

### 4.1 Layout switching（用户可调）
- StatusBar 右下角 `⊞` 按钮 → 弹层 6 选 1
- 三栏（Sidebar / Terminal / Explorer）的全排列共 6 种，用户随便选
- 切换时各栏当前比例**跟随栏一起搬走**（不重置）
- order + sizes 都持久化到 `~/.claude/parallel-agents.json` 的 `layout` 字段，重启恢复

## 5. Sidebar — Projects & Sessions

### 5.1 Projects（按 agent 分组）
- 显示成 tree：第一层是 agent 组（Claude / Codex / Gemini），可折叠
- 每个 agent 组下面列该 agent 的 project；图标是 agent 自己的图标
- Pin：置顶（组内）
- Hide：默认隐藏，菜单切 "Show hidden" 可见
- **Delete**：物理删除该 agent 在磁盘上的对应目录 + 清理 config（pin/hide/lastAgent/projectOrder）
  - **三次确认**：右键 Delete → 弹 ConfirmDialog → 输入框必须打 project displayName + 勾选 "I understand" 才能点 Delete
- **Reorder**：HTML5 native drag/drop，同 agent 组内拖；**跨组不允许**。新顺序存进 `projectOrder: Record<AgentId, string[]>`，重启保留

### 5.2 Sessions（当前选中 project 的）
- 时间倒序，**不可拖拽**
- hover 出 × 按钮 → 同样的 ConfirmDialog → 物理删除 jsonl 文件
- Gemini session 文件名 ≠ sessionId：删除时要遍历 jsonl 文件读 header 匹配

### 5.3 Agent picker
- "+ New Tab" 按钮点开 AgentPicker 弹层，显示所有 agent，未安装的灰
- 自动 remember 上一次这个 project 用的是哪个 agent（`lastAgentByProject`）

## 6. Middle — TerminalTabs

- 顶部 tab bar，每个 tab 显示 agent 图标 + project displayName
- 关 tab 时杀对应 PTY（不影响 Claude Code 之类的子进程持久化数据 —— 它们自己写文件）
- 同 project 可开多个 tab（不同 agent）
- 每个 tab 一个独立 xterm.js + node-pty 实例
- PATH 增强：spawn 时 prepend `extraPath` 让 agent 找到 npm global bin 等

## 7. Right Column — Explorer + Git

### 7.1 Explorer
- 显示当前选中 project 的 realPath 下的文件树
- **Operations**: 右键菜单
  - New File / New Folder
  - Rename（行内 input）
  - Cut / Copy / Paste（剪贴板 session-only，cut 行变灰）
  - Delete → 走 Windows 回收站（`shell.trashItem`，可恢复）
  - Reveal in File Explorer（`shell.showItemInFolder`）
  - Open（Windows 默认程序，`shell.openPath`）
- **Double-click**：文件和文件夹都走 `shell.openPath`（Windows 默认关联程序）
- **Keyboard**: 在 Explorer 内 Ctrl+C / Ctrl+X / Ctrl+V / F2 / Delete
- Paste 冲突：自动追加 ` (n)` 后缀重试

### 7.2 Git Panel
当所选 project 是 git 仓库时显示（参考 VSCode Source Control）：
- 顶部：branch 名 + ↓behind / ↑ahead + 刷新
- 三组：Staged Changes / Changes / Untracked，可分别整组 stage / unstage
- 每行：状态字母（M/A/D/R/U/!）彩色 + 路径 + hover 出 `+`（stage）/`−`（unstage）/`↺`（discard）
- 底部：commit message textarea + Commit 按钮
- 双击文件 → Monaco Diff Editor 全屏弹窗（lazy load）
- 自动刷新：`fs.watch` 监听 `.git/index` + `.git/HEAD`，800ms debounce + 5s 兜底轮询；事件经 `git:changed` IPC 广播给 renderer
- 非 git 目录显示 "(not a git repository)"

### 7.3 Diff Window
- Esc 关闭，全屏覆盖
- Monaco DiffEditor (`@monaco-editor/react`)，side-by-side，readOnly，`vs-dark`
- 老内容来自 `git show HEAD:<file>` 或 `git show :<file>`；新内容来自工作树文件或 index

## 8. Status Bar

- 左：Mode / Tabs 数
- 中：当前 project 的 realPath
- 右：`⊞` 布局切换按钮 → LayoutPicker

## 9. Persistence

全部存到 `~/.claude/parallel-agents.json`：

```jsonc
{
  "pinned":  ["<projectId>"],
  "hidden":  ["<projectId>"],
  "lastAgentByProject": { "<projectId>": "<agentId>" },
  "projectOrder":       { "<agentId>": ["<projectId>", ...] },
  "layout": {
    "order": ["sidebar", "middle", "right"],
    "sizes": [20, 58, 22]
  }
}
```

迁移：老版本只有 bare Claude `dirName` → 自动加 `claude:` 前缀；缺字段自动补默认值。

## 10. Release Workflow

- `npm run dev` —— electron-vite dev
- `npm run build` —— TS + Vite 构建
- `npm run release` —— build + electron-builder `--dir` + `scripts/promote-latest.cjs` 把产物升级到 `release/latest/`（用户保留稳定路径启动）

## 11. Non-Goals (v1)

- 跨平台（暂仅 Windows，macOS/Linux 未验证）
- Git: push / pull / 切分支 / merge 冲突解决（避免要做冲突 UI）
- Agent 之间消息中继（每个 tab 独立 PTY，无 cross-agent 联动）
- Cloud sync / 团队协作 / 多账号
- Aider / Codex 的 project 扫描（当前已支持 Claude / Gemini / Copilot）

## 12. Roadmap Hints

- 安装向导：检测缺失 CLI，给一键安装命令
- Search across sessions（全文检索 jsonl）
- Theme：除了 vs-dark 之外加 light
- macOS 打包
