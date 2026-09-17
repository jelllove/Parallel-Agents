---
description: Safety and evidence contracts for repository automation, tests, and CI
applyTo: 'scripts/**,tests/**,.github/workflows/**,schemas/**'
---

# Tooling and validation rules

- Keep engineering automation separate from application behavior. An engineering-only task must
  preserve application source/resources, runtime dependency contracts, and build behavior.
- Emit actual outcomes with explicit failure exit codes. A missing input, skipped check, or failed
  subprocess must not become a success-shaped receipt. Version machine-readable output contracts.
- Use Node executable/argument arrays for subprocesses. On Windows, do not assume `execFile` can
  launch `npm.cmd`; use the npm CLI through Node or another validated repository helper.
- Canonicalize both sides of containment checks. Windows short-path aliases can refer to the same
  directory; symlink/junction escapes must still be rejected.
- Clear Git repository-local environment before fixture operations; `git -C` does not neutralize
  an inherited absolute `GIT_INDEX_FILE` or alternate object/worktree paths. Reuse the shared
  isolation helper and test this using a disposable caller index, never a user's actual index.
- Keep generated artifacts under guarded `reports` directories. Preserve previous runs. Never
  serialize environment variables, credentials, real provider histories, or raw secret findings.
- Allocate fresh per-run test reporter destinations. Validating only a parent directory is not
  sufficient when an old destination file can be a symlink or hard link to other data.
- Secret scans must use Git-aware source scope and full redaction. The generated-credential
  integration test verifies both positive detection and absence of credential text in reports.
- Maintenance starts read-only. Explicit mutation is limited to its non-runtime allowlist and
  bounded validation. Roll back only writes still owned by the current run; preserve concurrent edits
  and fail visibly on a rollback conflict. Never reset, stash, clean, force-push, or auto-merge.
- Hook installation is opt-in and must not replace existing local or inherited hook policies.
  Repository-local Git configuration is shared by linked worktrees; do not install it as a setup side effect.
- Use default-shell, plainly named CI check steps where possible. Retain each outcome, failure
  reproduction guidance, JUnit/LCOV, and native evidence instead of inferring success from log presence.
- Workflow configuration is not evidence that it ran or that its checks/reviews are required.
  Production/native claims need the appropriate real execution, not a mock or a configuration file.
