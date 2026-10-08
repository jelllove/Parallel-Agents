# Validation receipt protocol v3

This is the implemented consumer contract for [CI receipts](../../scripts/ci-report.mjs).
The [schema](../../schemas/validation-report.v3.schema.json) defines the JSON shape.
It does not establish that a hosted workflow or native platform run occurred.

## Inputs and authority

`CI_PLATFORM` is `Windows`, `macOS`, or `Linux`. `CI_STEPS_JSON` supplies exactly ten
workflow-step outcomes: `install`, `lint`, `format`, `typecheck`, `tests`, `docs`,
`agent-corpus`, `build`, `native`, and `audit`. Accepted outcomes are `success`, `failure`,
`cancelled`, and `skipped`. Missing checks, unknown checks, invented outcomes, unsupported
platforms, and malformed input are rejected.

Outcomes must come from actual workflow steps, not manually fabricated success values.
Linux's native outcome is taken from the Xvfb-wrapped packaging step.

## Required checks and status

All ten checks, including native packaging, are required on every platform.
Any required failure yields `failure`; otherwise cancellation yields `cancelled`;
otherwise any non-success (including skipped native checks) yields `incomplete`.
Only ten successful outcomes yield `success`. The CLI exits nonzero for failure,
cancellation, incomplete execution, or malformed input.

The native reproduction command is `npm run pack` on Windows/macOS and
`xvfb-run -a npm run pack` on Linux. Both execute build, native smoke, unpacked
packaging without publishing, and real app.asar smoke.

## Output and retention

Receipts have `schemaVersion: 3`, `evidenceSource: workflow-step-outcomes`, a UTC
`generatedAt`, `platform`, computed `status`, ten `checks`, and `guidance`.
Each check has `name`, `command`, actual `outcome`, and `required: true`.
JSON and Markdown use a fresh directory under `reports/validation`, preserving earlier
runs. Report containment and summary destination checks remain unchanged.

JUnit/LCOV test evidence is separate and records only executed-module coverage.
Receipts do not certify installer interaction, Apple notarization, live-provider
compatibility, all Linux desktops, or remote branch-policy enforcement.

## Compatibility and validation

Version 3 adds macOS and makes native execution required on Linux. These required-check
changes are intentionally versioned; [v2](validation-v2.md) and [v1](validation-v1.md)
schemas remain unchanged for historical consumers. Do not reinterpret old receipts as v3.
[Reporter tests](../../tests/ci-report.test.mjs) cover positive results, skipped/failed
native outcomes on the new platforms, property contracts, malformed input, and retention.
