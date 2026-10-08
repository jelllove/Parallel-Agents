# Automation output contracts

[validation-report.v3.schema.json](validation-report.v3.schema.json) describes the current
version-three workflow receipt produced by [ci-report.mjs](../scripts/ci-report.mjs).
[Version two](validation-report.v2.schema.json) and
[version one](validation-report.v1.schema.json) remain available
for consumers of historical receipts.
The normative meanings, trust boundary, retention rules, and compatibility policy are documented in
[Validation receipt protocol v3](../docs/specs/validation-v3.md).

The receipt records explicit outcomes supplied by the workflow for install, lint, formatting,
types, tests, documentation, agent instruction corpus validation, build, native validation, and
dependency audit. Unknown or absent outcomes are errors; required skipped checks produce an
incomplete result, not success. Windows, macOS, and Linux all require native packaging;
the Linux native command runs under Xvfb.

Reports are written to unique directories under `reports/validation`. The associated Markdown
summary contains fixed reproduction commands for failed checks. It is not a replacement for
the test artifacts or a claim of production, provider, or remote-policy qualification.

Consumers should dispatch on `schemaVersion`. Incompatible changes require a new version rather
than silently reinterpreting existing receipts.

[evidence.v1.schema.json](evidence.v1.schema.json) defines separate source/content binding for
validation artifacts. Its [protocol](../docs/specs/evidence-v1.md) distinguishes artifact integrity
from execution authority; a valid hash does not certify that a declared check actually ran.

[agent-learned-rules.v1.schema.json](agent-learned-rules.v1.schema.json) describes the bounded
candidate/active/retired learned-rule corpus consumed by
[check-agent-corpus.mjs](../scripts/check-agent-corpus.mjs). The script enforces additional
repository-containment and active-rule evidence constraints that JSON Schema cannot prove alone.
