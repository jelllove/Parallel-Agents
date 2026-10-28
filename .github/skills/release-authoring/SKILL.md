---
name: release-authoring
description: Author, validate, and explicitly publish a Parallel Agents release only with complete Windows, native ARM64 and Intel macOS, and Linux packages from the same verified source commit.
---

# Release authoring

Use this skill whenever asked to create, generate, prepare, mirror, or publish a release,
or modify the release format/architecture matrix. It is a release procedure, not authorization
to commit, push, tag, merge, authenticate providers, or publish during an ordinary coding task.
Read [AGENTS.md](../../../AGENTS.md) and the
[packaging contract](../../../CONTRIBUTING.md#optional-local-packaging) first.

## Required release matrix

Every release must contain all four native targets from one version and one exact commit:

| Native target   | Required distributions                                                   | Runner           |
| --------------- | ------------------------------------------------------------------------ | ---------------- |
| Windows x64     | NSIS `.exe`, executable `.blockmap`, `latest.yml`, unpack-and-run `.zip` | `windows-latest` |
| macOS ARM64     | `.dmg`, `.zip`                                                           | `macos-15`       |
| macOS Intel x64 | `.dmg`, `.zip`                                                           | `macos-15-intel` |
| Linux x64       | `.deb`, `.AppImage`, `.tar.gz`, `.rpm`                                   | `ubuntu-24.04`   |

The authoritative filenames are
[requiredReleaseAssets](../../../scripts/release-assets.mjs);
[package.json](../../../package.json) supplies version and targets. Do not substitute one Mac
architecture for the other, release only the local Windows output, silently drop RPM/archives,
or describe unsupported architectures as supported. A matrix change must agree across the
manifest, native jobs, shared asset guard, tests, skill, and installation documentation.

## Procedure

### 1. Establish authorized destinations and source

- Inspect the working tree; preserve unrelated edits, existing tags, and earlier release assets.
- Confirm every destination repository and account. `qinqingxu` and `qinqiangxu` are different
  names; never infer a mirror URL or silently replace one with the other.
- Before each GitHub operation inspect `git remote get-url origin`, select the authorized
  account with `gh auth switch`, and verify it using `gh api --hostname github.com user --jq .login`.
  For the current `jelllove` origin, use `gh auth switch --hostname github.com --user jelllove`.
  An unknown remote/account mapping requires confirmation.
- Use a new unused version. With explicit release authorization, update both manifest and lock
  metadata through `npm version <new-version> --no-git-tag-version --ignore-scripts`.
  Never overwrite a public tag or replace published assets to make a broken release look complete.
- Run `npm run validate` and `npm audit --audit-level=high`, then commit/push only when requested.
  Check secrets before publishing source. Never bypass hooks, independent approval, or main protection.
- Record the full source SHA with `git rev-parse HEAD`; do not use only a branch name.

### 2. Obtain real native build evidence

Use the [Release packages workflow](../../../.github/workflows/release.yml) on that exact SHA.
Publishing the existing feature branch or a matching version tag triggers it; a manual dispatch
requires the workflow to be available in the repository. Inspect the actual run rather than
assuming the configuration ran. Each job runs locked installation, checks, high-severity audit,
`npm run dist`, native Electron/PTY smoke, and actual app.asar smoke with isolated provider shims.
Linux uses Xvfb and the sandbox; keep it enabled. `pack`/`dist` always retain `--publish never`
through the [native packaging runner](../../../scripts/package-desktop.mjs).

The final **Verify complete release set** job must succeed after all four package jobs.
It downloads the current run's artifacts and invokes the
[full-set guard](../../../scripts/verify-release-set.mjs). A local build, mock receipt, stale
successful workflow, or a successful ARM64 job does not qualify an Intel package.

Example inspection (replace the variables with actual values; do not fabricate outcomes):

```powershell
$repo = 'jelllove/Parallel-Agents'
$sha = git rev-parse HEAD
gh run list --repo $repo --commit $sha --limit 5 --json databaseId,headSha,status,conclusion,url
gh run view $runId --repo $repo --json headSha,status,conclusion,jobs,url
```

Require `headSha` equal to `$sha`, overall `conclusion` equal to `success`, all four native jobs
successful, and the aggregate job successful. Investigate any failed/cancelled/skipped job;
do not weaken the audit or native gates. The workflow receipt is not proof of signing,
notarization, every Linux distribution, or manual installer behavior.

### 3. Verify and stage the whole publication set

Prefer the aggregate `verified-release-set` artifact. It contains all distributions,
optional archive blockmaps, `SHA256SUMS`, and `release-set.json`. Independently verify its manifest
version/commit/target list and every checksum after downloading; then compare uploaded asset
digests to the same staged files.

For a fresh independent verification, download the native packages and evidence into one new
directory without merging artifact folders:

```powershell
$download = Join-Path (Get-Location) ('reports\release-download-' + [guid]::NewGuid().ToString('N'))
gh run download $runId --repo $repo --dir $download --pattern 'packages-*' --pattern 'release-evidence-*'
npm run verify:release -- --artifacts $download --commit $sha
```

The command checks all OS/architecture folders, schema/version/commit, both native receipts,
exact filenames, file sizes and SHA-256. It rejects incomplete sets, wrong architectures,
corruption, ambiguous receipts, unexpected files, and symlink escapes. It creates a fresh
staged folder under `reports/release-sets`; use that exact folder, not a wildcard over all
historical reports or the local `release` directory. Partial runs must not be published.

Artifact consistency is not independent execution authority: only trusted, actually successful
native CI supplies the receipts. Do not manually construct success JSON to satisfy the guard.

### 4. Draft, verify, then publish explicitly

Publication requires the user's explicit request. Create the new tag pointing to the verified
SHA without force, then upload the entire verified set to a draft release:

```powershell
$assets = @(Get-ChildItem -LiteralPath $staged -File | ForEach-Object FullName)
gh release create $tag @assets --repo $repo --draft --verify-tag --target $sha --title $title --notes-file $notes
gh release view $tag --repo $repo --json tagName,isDraft,targetCommitish,assets,url
```

Before publishing, verify the remote tag resolves to `$sha`, version/tag match, all expected
names exist, each asset is uploaded, and every remote digest/size matches the staged file.
Only then use `gh release edit $tag --repo $repo --draft=false --prerelease=false --latest`.
Do not use `--clobber`, publish just the installer, or consider a draft a completed public release.
Mirror the same verified bytes only to explicitly confirmed destinations, authenticate each
account separately, and verify both source refs and uploaded digests. Report unresolved mirrors
as blocked instead of claiming synchronization.

## Release notes and handoff

Include a download table for every native target, source SHA, successful run URL, exact check
commands/results, and `SHA256SUMS`. Explain that Mac builds are ad-hoc signed/not notarized,
Mac/Linux updates are manual, Windows ZIP is not profile-isolated, and choosing its Windows
in-app installer update installs NSIS instead of replacing the archive folder.
Name Ubuntu 24.04 as the Linux CI qualification target; generating RPM there is not proof of
Fedora/RHEL installation or SELinux compatibility. Keep unverified interactive checks explicit.
Report public release URLs, destination refs, artifact count, and any incomplete authorization.

Good: all four native targets, same SHA/version, real smoke evidence, aggregate verification,
draft upload digests checked, then explicit publication.
Bad: only a Windows EXE, missing Intel/RPM/archive, old artifacts from another SHA, or a forged
green receipt while declaring a complete cross-platform release.

The skill is a durable agent procedure and the workflow is a deterministic completeness gate,
not a permission system. Direct manual GitHub publication can bypass a workflow; repository owners
must manage publication permissions separately. Never claim prose guarantees external enforcement.
