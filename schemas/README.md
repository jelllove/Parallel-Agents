# Automation output contracts

[validation-report.v1.schema.json](validation-report.v1.schema.json) describes the version-one
workflow receipt produced by [ci-report.mjs](../scripts/ci-report.mjs).
The normative meanings, trust boundary, retention rules, and compatibility policy are documented in
[Validation receipt protocol v1](../docs/specs/validation-v1.md).

The receipt records explicit outcomes supplied by the workflow for install, lint, formatting,
types, tests, documentation, build, native validation, and dependency audit. Unknown or absent
outcomes are errors; required skipped checks produce an incomplete result, not success.
Linux records native validation as skipped because the desktop runtime is Windows-only.

Reports are written to unique directories under `reports/validation`. The associated Markdown
summary contains fixed reproduction commands for failed checks. It is not a replacement for
the test artifacts or a claim of production, provider, or remote-policy qualification.

Consumers should dispatch on `schemaVersion`. Incompatible changes require a new version rather
than silently reinterpreting existing receipts.

[evidence.v1.schema.json](evidence.v1.schema.json) defines separate source/content binding for
validation artifacts. Its [protocol](../docs/specs/evidence-v1.md) distinguishes artifact integrity
from execution authority; a valid hash does not certify that a declared check actually ran.
