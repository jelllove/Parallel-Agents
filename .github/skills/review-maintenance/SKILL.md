---
name: review-maintenance
description: Inspect or apply a bounded non-runtime formatting proposal with protected inputs, real validation, rollback evidence, and human review.
---

# Review maintenance

Use this workflow for repository-formatting upkeep, a scheduled maintenance artifact, or a request
to improve engineering hygiene without changing application behavior. Follow [AGENTS.md](../../../AGENTS.md).

## Inspect without mutation

```powershell
npm run maintenance:check
```

Default mode and `--dry-run` only inspect Git-visible candidates. They do not repair files.
Use the version-one JSON receipt's mode, status, inventory, changes, protection fingerprints,
validation, rollback, artifacts, and errors. Never describe an inspection as an applied repair.

The hard boundary excludes application source/resources, manifests/locks, build inputs, scripts,
tests, binary/generated/history files, ignored paths, and links. Only bounded active documentation
and `.github` Markdown/YAML can be formatted. Optional policy can narrow this set, never widen it.

## Explicit repair

On an explicitly approved, clean checkout:

```powershell
npm run maintenance:apply -- --output reports/maintenance/new-run.json --patch reports/maintenance/new-run.patch
```

Choose new relative artifact paths under the ignored maintenance-report directory. Existing
artifacts are refused, not overwritten. Do not reset, stash, clean, or discard work to satisfy
the clean-tree requirement. On a dirty working tree, remain in check mode.

The driver performs one formatting pass and runs the existing `npm run check`. Inspect the
validation result and unchanged protected fingerprints before accepting the patch. A failure
restores only writes still owned by the run. If another process edited a file, preserve its data
and report the conflict rather than forcing rollback.

## Human decision

Before changing the maintenance driver or its safety boundaries, run `npm run test:maintenance-loop`
on Windows. This [whole-candidate recovery experiment](../../../docs/self-healing-ci.md) must prove
actual failure detection, repair/revalidation and byte-exact rollback while leaving the original
checkout untouched. It is intentionally separate from the validation command run during repairs.

The [proposal workflow](../../workflows/maintenance.yml) handles scheduled/manual requests and
failed default-branch push validation from this repository. It always checks out the current
trusted default branch, never a fork/PR or event-supplied head, with read-only repository permissions.
It emits artifacts, not commits or pull requests; a proposal does not turn an older run green.
The [read-only reviewer](../../agents/maintenance-review.agent.md) can inspect the proposal.

A human decides whether to apply the patch or create/merge a pull request. Never auto-merge,
grant new permissions, fabricate successful checks, or turn this into a generic code-repair loop.
See the [versioned maintenance protocol](../../../docs/specs/maintenance-v1.md) for limits and exit semantics.
