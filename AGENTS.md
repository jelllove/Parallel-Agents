# Repository guide for coding agents

Parallel Agents is an existing Windows-first Electron application. Improve it through scoped,
behavior-preserving fixes, tests, and maintainable boundaries; do not add product features,
dependencies, fake commands, or assessment-only scaffolding without a real task requirement.

## Start with the actual contracts

- Read [README.md](README.md) for current usage, [CONTRIBUTING.md](CONTRIBUTING.md) for commands and
  test practices, and [ARCHITECTURE.md](ARCHITECTURE.md) for the implementation map.
- Treat [package.json](package.json), source, and focused tests as authoritative when prose differs.
  [SPEC.md](SPEC.md) and historical hackathon material describe intent, not guaranteed current behavior.
- Inspect the target files and `git --no-pager status --short` before editing. Work may be shared or
  already dirty. Preserve unrelated changes and do not undo another contributor's work.
- Do not change historical media/design artifacts in `Hackathon` or `docs\superpowers` unless that
  is the explicit task.

## Local workflow

Use Windows paths and PowerShell for local setup. [.node-version](.node-version) pins Node.js
**24.17.0**; the manifest's compatible engine ranges are Node `^24.17.0` and npm `>=11 <12`.

1. For a fresh checkout or changed/missing dependencies, use `npm ci`. Do not regenerate a lockfile
   or install machine-wide build tools merely to investigate.
2. Add a focused failing `node:test` regression fixture before changing behavior. Run the smallest
   relevant test command, then cover directly coupled behavior.
3. Use `npm run check` for lint, format verification, type checking, local tests, and docs checking.
   `npm run build` adds type checking and Electron bundles; `npm run validate` combines both gates.
4. Use `npm run format:check` to inspect formatting. `npm run format` rewrites files; do not sweep
   unrelated files in a shared working tree. Inspect the final diff.
5. Report exact commands/results and any remaining unverified behavior. A passing build is not a
   live-provider test, evidence of remote CI, or a claim of enforced branch protection.

The configured `Validate (Windows)` and `Validate (Linux)` jobs are described in the
[CI boundary guide](CONTRIBUTING.md#ci-definitions-and-owner-settings). Linux only validates
non-GUI checks/builds; do not describe it as a supported product runtime. Workflow/CODEOWNERS
files do not enable required checks or owner-review enforcement. Those remote settings remain
an owner action after publishing, not an implicit part of local engineering work.

The [full command table](CONTRIBUTING.md#local-commands) is shared with human contributors.
Use the [validation skill](.github/skills/validate-changes/SKILL.md) and
[automation guide](docs/automation.md) for repeatable non-runtime checks and evidence handling.
The [development environment guide](docs/development-environment.md) is authoritative for doctor,
setup, and non-GUI container boundaries. Use the [maintenance review skill](.github/skills/review-maintenance/SKILL.md)
for explicit, clean-tree formatting proposals; never widen its hard boundary or auto-publish a patch.
CI receipts must record actual step outcomes; do not fabricate green results or infer that a
workflow/review requirement is active from configuration alone. Local hooks remain explicit opt-in
and must preserve existing or inherited Git policies.
Optional `npm run test:coverage` reports only tested-module coverage, not whole-repository or
native-runtime coverage. Do not treat a smoke-script definition as a completed native verification.
For native changes, the separate Windows-only `npm run test:smoke` requires `npm run build` first.
It runs real Electron/PTY checks against generated disposable data, without provider accounts.
It is not part of `check` or `validate`; follow the
[native smoke procedure](CONTRIBUTING.md#windows-native-smoke-test) and report the actual result.
The docs checker fixture can run without dependencies:

```powershell
node --test --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests\check-docs.test.mjs
```

## Preserve user data and control side effects

- Tests must use fresh temporary fixture directories and cleanup hooks, not the current repository's
  working files or real provider histories. Repository-local generated test artifacts belong under
  `reports`; delete only the fixture directory the test created.
- Git fixtures must clear repository-local Git environment before running commands. `git -C`
  alone does not prevent inherited `GIT_INDEX_FILE`/`GIT_DIR` from redirecting writes into the caller.
  Standard test commands preload [the isolation helper](tests/helpers/isolated-git.mjs).
- Inject home/config paths and PTY/process dependencies when available. For home-sensitive modules,
  isolate HOME/USERPROFILE before import. No ambient AI-provider credentials are required for the
  static/type/test/docs checks.
- Do not launch a real agent, log in, read credentials, alter global tooling, or access provider
  histories just to validate an unrelated change. Interactive app testing can touch real user state.
- Do not delete or reset `$HOME\.claude\parallel-agents.json`, provider session directories, or user
  projects to repair a failure. Preserve malformed data and report the error; intentional manual
  recovery needs a backup.
- Preserve confirmations for destructive UI actions. History deletion is permanent, unlike Explorer
  trash; Git discard, commits, and filesystem moves also change real data.
- Do not reset/clean/stash away user edits, create commits/worktrees, rewrite branches, push, publish,
  upload artifacts, or invoke release promotion unless requested. Ordinary checks are local and
  do not require packaging.
- When packaging is explicitly needed, keep `--publish never`. `npm run release` removes/replaces
  `release\latest`; it is not a harmless validation command.
- Standard Windows install/packaging retains upstream `node-pty` N-API prebuilds with
  `build.npmRebuild: false`. Do not force an unnecessary source rebuild, disable Spectre mitigations,
  or modify system tooling to make packaging succeed. Compiler and matching Spectre prerequisites
  belong only to an explicit [source-build workflow](CONTRIBUTING.md#native-terminal-troubleshooting).
  Preserve both native and real-`app.asar` smoke gates in `pack`/`dist`.

## Maintain the boundaries

- IPC changes must agree across [shared types](src/shared/types.ts), [main handlers](src/main/ipc.ts),
  [preload](src/preload/index.ts), and renderer callers. Keep Node/system access in main.
- Use `import type` for type-only references with the repository's `verbatimModuleSyntax` setting.
- Preserve the window's explicit `sandbox: true`, `contextIsolation: true`, and
  `nodeIntegration: false` settings. These boundaries do not validate external data or make
  TypeScript casts runtime checks.
- Keep config validation/migration in [the schema](src/main/config-schema.ts), persistence in
  [the path-injected store](src/main/config-store.ts), and Electron home lookup in
  [the adapter](src/main/config.ts). Do not hide I/O failures or overwrite malformed user files.
- Preserve project-ID-based tab/PTY identity and event/timer cleanup. Do not silently turn reopening
  a project into a different terminal model.
- Keep [the native PTY singleton](src/main/pty-manager.ts) thin. Lifecycle behavior and deterministic
  tests belong at [the injected manager seam](src/main/pty-session-manager.ts), preserving stale
  callback guards, timer cleanup, and explicit native resize/kill error reporting.
- Preserve Git's HEAD/index/working-tree distinctions, literal pathspecs, rename handling,
  NUL-delimited records, linked-worktree metadata watching, and useful failures. Test Git changes
  in isolated repositories with hooks/signing disabled.
- Use [shared command builders](src/shared/agent-commands.ts); the Copilot executable is `copilot`.
  Binary detection does not establish authentication or compatibility with every provider version.
- Preserve [DiffWindow's lazy local Monaco setup](ARCHITECTURE.md#offline-diff-loading) and local
  worker routing. The native smoke selects a generated Claude project and renders its Git diff
  with HTTP(S) blocked in the Electron session. Keep the inert provider shims and isolated data;
  do not enable CDN access or real provider CLIs/accounts to make that regression pass.
- Keep the scoped `monaco-editor` → `dompurify` override until upstream declares a safe version
  that the lockfile resolves without it. Follow [dependency maintenance](CONTRIBUTING.md#dependency-maintenance);
  do not use force/prerelease upgrades or remove the override merely to change audit counts.

## Keep documentation honest

Update active documentation when scripts, paths, APIs, or behavior change. `npm run check:docs`
discovers active working-tree Markdown, including new untracked documents, and verifies a narrow
set of npm commands and local references. Its [documented exclusions and limits](CONTRIBUTING.md#documentation-contract-check)
are deliberate; do not add broad suppressions or mislabel real runnable commands as examples.
Review behavioral prose against source, since the checker does not prove semantic agreement.
