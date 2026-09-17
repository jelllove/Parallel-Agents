# Documentation assets

Current behavior and contributor commands are documented in the
[project README](../README.md), [architecture](../ARCHITECTURE.md), and
[contribution guide](../CONTRIBUTING.md). Historical design material under
`superpowers` is not an executable description of the current application.

Screenshot placeholder files are not supplied. The README's demo artwork is
separate from screenshots of a verified running build.

## Capture review evidence

1. On Windows, run `npm run build` followed by `npm run test:smoke`.
2. Inspect the generated `reports/smoke.json` and `reports/smoke.png`.
   These show isolated fixture data and inert CLI shims, not live AI-provider
   sessions. `npm run pack` also generates packaged-payload smoke evidence.
3. For interactive changes, capture the affected feature with the Windows
   Snipping Tool or ShareX. Use a consistent window size and identify the theme.
4. Remove private paths, prompts, credentials, and session content before sharing.
   Attach before/after evidence to the pull request.

Generated reports are ignored by Git. If an approved screenshot is intentionally
added here, update its README reference explicitly; files are not discovered or
published automatically.
