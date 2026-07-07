# Security Policy

## Supported Versions

Parallel Agents is pre-1.0 software. Only the **latest** released version on the
[Releases page](https://github.com/jelllove/ParallelAgents/releases) is supported
for security fixes. If you are running an older build, please update before
filing a report.

| Version | Supported |
| ------- | --------- |
| Latest release | ✅ |
| Older releases | ❌ |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Instead, please report them privately via one of these channels:

1. **Preferred** — [GitHub Security Advisories](https://github.com/jelllove/ParallelAgents/security/advisories/new) (private, encrypted, integrates with CVE issuance)
2. **Email** — `jelllove@gmail.com` with the subject line prefix `[security]`

Please include as much of the following as you can:

- Type of issue (e.g. RCE, path traversal, IPC abuse, prototype pollution, etc.)
- Full paths of source files related to the issue
- Steps to reproduce (a minimal proof-of-concept is gold)
- Impact: what an attacker can do with this
- Any suggested mitigation, if you have one

## Response Process

- **Within 72 hours** — acknowledgement that the report was received
- **Within 7 days** — initial assessment with a rough severity rating
- **Within 30 days** — either a fix released, or a public timeline for one

Once the issue is fixed and a release is published, we will credit you in the
release notes (unless you ask to stay anonymous).

## Scope

In scope:

- The Parallel Agents Electron application itself (main / preload / renderer)
- IPC channel surface (`window.api.*`)
- The packaging and release flow
- Configuration / persistence handling (`~/.claude/parallel-agents.json`)

Out of scope:

- Vulnerabilities in the upstream CLIs we launch (Claude Code, Codex, Gemini, etc.) — please report those to their respective projects
- Vulnerabilities in Electron, Node.js, or other third-party dependencies — please report those upstream and we will pick up the fix when a patched version is published
- Social engineering of project maintainers

Thanks for helping keep Parallel Agents and its users safe.
