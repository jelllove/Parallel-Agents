# Contributing to Parallel Agents

Thanks for your interest in making Parallel Agents better! This document covers how to file issues, how to send pull requests, and the conventions we follow.

By participating in this project you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## 🗣 Before you start

- **Bug?** → [open an issue](https://github.com/jelllove/ParallelAgents/issues/new/choose) with the "Bug report" template.
- **Feature idea?** → [open an issue](https://github.com/jelllove/ParallelAgents/issues/new/choose) with the "Feature request" template **first**, before writing code. Non-trivial PRs without a prior issue may be closed.
- **Security vulnerability?** → please **do not** open a public issue. See [SECURITY.md](SECURITY.md).
- **Just a question?** → use [GitHub Discussions](https://github.com/jelllove/ParallelAgents/discussions) instead of an issue.

---

## 🛠 Development setup

```bash
git clone https://github.com/jelllove/ParallelAgents.git
cd ParallelAgents
npm install
npm run dev          # electron-vite dev with HMR
```

Requirements:

- **Node.js 20+**
- **Windows** (this is currently the only supported platform; PRs that add macOS/Linux are very welcome — start by extending `decodeDirName` in `src/main/projects.ts`)
- **Windows Build Tools** for compiling `node-pty`. If you hit native-build errors, run the bundled helper: `./install-vs-buildtools.ps1`.

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev mode with hot reload for main / preload / renderer |
| `npm run build` | Type-check and build to `out/` |
| `npm run pack` | Build + electron-builder `--dir` only (no installer) |
| `npm run release` | Full release: build → package → promote to `release/latest/` |
| `npm run rebuild` | Rebuild `node-pty` against current Electron ABI |

---

## 📁 Code layout (cheat sheet)

```
src/
├── main/        Node side — IPC, PTY, Git, filesystem, config
├── preload/     contextBridge — thin wrapper around ipcRenderer
├── renderer/    React UI — components, Zustand store, styles
└── shared/      Types used by both sides (the Api surface lives here)
```

The **IPC channel layout** is documented in [`ARCHITECTURE.md`](ARCHITECTURE.md#4-ipc-channels按命名空间). If you add a new channel, you'll touch four places:

1. `src/shared/types.ts` — declare it on the `Api` interface
2. `src/main/ipc.ts` — `ipcMain.handle(...)`
3. `src/preload/index.ts` — expose it on `window.api`
4. `src/renderer/...` — use it from the store or a component

If you skip step 1 you'll get a confusing runtime error rather than a compile error — please don't skip it.

---

## ✅ Pull request checklist

Before opening a PR:

- [ ] `npm run build` passes (no TypeScript errors)
- [ ] `npm run release` produces a working `release/latest/Parallel Agents.exe`
- [ ] You manually exercised the affected feature in the running app (this is a UI app — tests can't tell you it looks right)
- [ ] **For UI changes**: a before/after screenshot or short clip is attached in the PR description
- [ ] **For new IPC channels**: all four layers (shared / main / preload / renderer) are updated
- [ ] Commits are reasonably tidy (rebase / squash WIP commits before requesting review)
- [ ] The PR description explains *why* — not just *what*

We don't enforce conventional commits, but a short imperative subject (≤ 72 chars) followed by a blank line and an optional body is appreciated.

---

## 🧭 Design principles

A few opinions that guide the codebase:

1. **One window beats N terminals.** Anything that breaks the single-window UX should be questioned hard.
2. **Trust the underlying CLI.** We launch real PTYs and shell out to real `git`; we don't reimplement agent behavior or build a fake shell.
3. **Persist nothing the user didn't ask us to.** Configuration lives in `~/.claude/parallel-agents.json` — nothing else.
4. **Destructive actions require friction.** Delete flows must use `ConfirmDialog` (type-the-name + checkbox), not a single confirm() prompt.
5. **No-frills dependencies.** Every new dependency should pull its weight; React, Zustand, xterm, node-pty, Monaco are the load-bearing ones and we prefer to keep that list short.

---

## 🤔 Stuck?

- Skim [`SPEC.md`](SPEC.md) for the product intent
- Skim [`ARCHITECTURE.md`](ARCHITECTURE.md) for the technical map
- Search existing [issues](https://github.com/jelllove/ParallelAgents/issues) and [discussions](https://github.com/jelllove/ParallelAgents/discussions)
- Still stuck? Open a discussion — we'd rather hear from you than have you bounce.

Thanks again — every PR, every issue, every star helps. 🙏
