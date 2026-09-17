# Parallel Agents — Product Spec

> 一个桌面应用，让多个 CLI coding agent（Claude Code / Codex / Gemini CLI 等）在同一个窗口里并行使用，不再每个 agent 开一个独立 terminal。

- **Author**: jelllove ([jelllove@gmail.com](mailto:jelllove@gmail.com))
- **Platform**: Windows (Electron, win-unpacked)
- **License**: MIT

本文区分当前实现与未来方向；实现结构和可执行验证流程见 [ARCHITECTURE.md](ARCHITECTURE.md) 与 [CONTRIBUTING.md](CONTRIBUTING.md)。

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
- `copilot:C:\some\path` —— 从 `~/.copilot/session-state/` 的事件头按 Git 根目录或 cwd 聚合
- `adhoc:C:\some\path` —— 用户用 "Pick directory" 现场加的目录

### Session

某个 agent 在某 project 下的一次对话历史：

- Claude: `~/.claude/projects/<dirName>/<sessionId>.jsonl`
- Gemini: `~/.gemini/tmp/<dirName>/chats/<file>.jsonl`（filename ≠ sessionId，靠读 jsonl 头匹配）
- Copilot: `~/.copilot/session-state/<sessionDir>/events.jsonl`
- 解析会跳过不完整或形状不符的记录；缺少或无效的时间使用文件修改时间，意外 I/O 错误会向调用方报告。

### Tab

打开的一个 PTY shell。当前以 projectId 标识 tab，同一 projectId 最多有一个打开的 tab；重复选择会复用或恢复该 tab，而不是创建另一个独立 PTY。不同 projectId 可以指向同一个磁盘目录。

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

- 显示成 tree：第一层是 agent 组（Copilot / Codex / Claude / Gemini / Aider），可折叠；当前自动发现 Claude / Gemini / Copilot 项目
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

- "+ New Project" 按钮点开 AgentPicker 弹层，选择 agent 和目录；未安装的 CLI 会提供安装提示
- 自动 remember 上一次这个 project 用的是哪个 agent（`lastAgentByProject`）

## 6. Middle — TerminalTabs

- 顶部 tab bar，每个 tab 显示 agent 图标 + project displayName
- 关 tab 时按设置确认，然后终止对应 PTY；不删除 agent 已写入的会话历史
- 同一 projectId 复用一个 tab，不承诺任意多个同 ID 独立终端
- 每个 tab 一个独立 xterm.js + node-pty 实例
- 终端代码按需加载，初始命令仅在终端挂载时消费；提前关闭会取消尚未消费的命令
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
- 仓库根或 worktree 根的自动刷新：监听实际 Git 元数据目录内的 index/HEAD 变化，800ms debounce + 5s 兜底轮询；事件经 `git:changed` IPC 广播给 renderer
- 非 git 目录显示 "(not a git repository)"

### 7.3 Diff Window

- Esc 关闭，全屏覆盖
- Monaco DiffEditor (`@monaco-editor/react`)，side-by-side、readOnly，跟随明暗主题
- 编辑器和语言 worker 从本地构建产物按需加载，不依赖 CDN
- 已暂存差异比较 HEAD 与 index；未暂存差异比较 index 与工作树
- Git 状态中的路径相对于 worktree 根目录；项目位于仓库子目录时，文件操作仍以该根目录解析

## 8. Status Bar

- 左：Mode / Tabs 数
- 中：当前 project 的 realPath
- 右：`⊞` 布局切换按钮 → LayoutPicker

## 9. Persistence

应用偏好配置存到 `~/.claude/parallel-agents.json`；agent 会话仍由各 CLI 自己存储：

```json
{
  "pinned": ["claude:C--example-project"],
  "hidden": [],
  "lastAgentByProject": { "claude:C--example-project": "claude" },
  "projectOrder": { "claude": ["claude:C--example-project"] },
  "layout": {
    "order": ["sidebar", "middle", "right"],
    "sizes": [20, 58, 22]
  },
  "theme": "dark",
  "confirmOnCloseTab": true,
  "terminalMultilineEnter": true,
  "terminalCopyPaste": true
}
```

迁移：老版本 bare Claude `dirName` 自动加 `claude:` 前缀，缺字段补默认值。格式损坏或非法字段会明确报错，不会静默覆盖原文件。

同一进程内的配置修改串行执行并通过临时文件原子替换。此约定不包括多进程协调、外部编辑同步或 fsync 持久性保证。打开的 tabs、运行中的 PTY 和临时剪贴板不持久化。

## 10. Release Workflow

- `npm run dev` —— electron-vite dev
- `npm run check` —— 格式、lint、类型、回归测试与文档契约校验
- `npm run build` —— TS + Vite 构建
- `npm run pack` —— Windows 本地构建、原生冒烟、打包与实际 app.asar 内容冒烟
- `npm run release` —— pack 验证通过后，由 `scripts/promote-latest.cjs` 将产物提升到 `release/latest/`
- 打包命令显式禁止网络发布；这些本地检查不代表已验证安装器、签名或线上发布流程

## 11. Non-Goals (v1)

- 跨平台（暂仅 Windows，macOS/Linux 未验证）
- Git: push / pull / 切分支 / merge 冲突解决（避免要做冲突 UI）
- Agent 之间消息中继（每个 tab 独立 PTY，无 cross-agent 联动）
- Cloud sync / 团队协作 / 多账号
- Aider / Codex 的 project 扫描（当前已支持 Claude / Gemini / Copilot）

## 12. Roadmap Hints

- 安装向导：检测缺失 CLI，给一键安装命令
- Search across sessions（全文检索 jsonl）
- 为同一 projectId 设计独立的多终端标识与生命周期
- macOS 打包
