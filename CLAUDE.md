# Claude Code repository entry point

Read [AGENTS.md](AGENTS.md) before making changes. It is the shared source of repository boundaries,
validation commands, native fixture isolation, maintenance policy, and evidence expectations.

[Project settings](.claude/settings.json) add narrow safeguards for common destructive Git commands,
local secret files, and publication/review actions. They do not auto-approve commands, select a model,
disable normal permissions, or install hooks. Local settings remain ignored by Git.

Command patterns are convenience guardrails, not a complete shell sandbox: alternate spellings,
wrappers, or user configuration can change matching. Preserve the broader rules in the shared guide,
and obtain explicit authorization before publishing, rewriting history, or replacing user data.
These development-agent settings do not alter the Parallel Agents application's runtime.
