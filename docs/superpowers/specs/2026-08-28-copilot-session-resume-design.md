# Copilot Session Resume Design

## Goal

Make GitHub Copilot projects resume their actual Copilot CLI sessions instead of
starting a new, unparameterized `copilot` process.

When a user selects a Copilot project:

- With no sessions, start a new session using `copilot`.
- With one session, open it directly using `copilot --resume=<session-id>`.
- With multiple sessions, do not start a terminal. Highlight the **Recent
  Sessions** area so the user can choose a session, then resume the selected
  session using its ID.

## Session Source

Read Copilot session metadata from `~/.copilot/session-store.db` in read-only
mode. The `sessions` table provides the fields needed by the application:

- `id`: the value passed to `copilot --resume=<session-id>`
- `cwd`: the project directory used to group sessions
- `summary`: the session title shown in the UI
- `created_at` and `updated_at`: ordering and activity timestamps
- `branch`: optional session metadata

The main process owns database access. Renderer code receives only the existing
`Project` and `Session` models through IPC.

## Project and Session Mapping

Copilot projects are grouped by normalized `cwd`. Path matching is
case-insensitive on Windows and case-sensitive on other platforms. Empty or
invalid working directories are ignored because they cannot be opened as a
project.

Each distinct working directory becomes a Copilot `Project` with:

- an ID namespaced with `copilot:`
- the original working directory as `realPath`
- session count and most recent `updated_at` as project activity
- the existing pinned, hidden, ordering, and existence behavior

Each database row becomes a `Session`. Sessions are sorted by most recent
activity first. A missing or empty summary uses the existing no-message
placeholder rather than exposing database internals.

## Launch Flow

Project selection first loads the project's sessions before deciding whether to
launch:

1. If the terminal tab is already open, activate it and do not replace its
   running process.
2. If there are no Copilot sessions, open the tab with `copilot`.
3. If there is exactly one session, open the tab with
   `copilot --resume=<session-id>`.
4. If there are multiple sessions, select the project but do not open a
   terminal. Trigger a short-lived attention state on **Recent Sessions**.
5. Clicking a session opens or restarts the project tab with
   `copilot --resume=<session-id>`.

The resume command is generated in the shared provider/command mapping, not in
the click handler. Copilot is marked as supporting resume.

## Recent Sessions Attention State

The application store exposes a transient attention token or nonce for the
Recent Sessions section. Selecting a Copilot project with multiple sessions
increments the token. The sidebar responds by replaying a finite CSS animation
on the section header or container.

The animation is informational only:

- It does not steal keyboard focus.
- It does not repeatedly flash.
- It respects `prefers-reduced-motion` by using a static highlight.
- It does not change session selection or launch behavior.

## Database and Error Handling

Database access is read-only and closes its connection after each query or
well-defined read operation. The implementation must not migrate or write to
Copilot's database.

Expected absence of the database means there are no discoverable Copilot
projects. Query failures are logged in the main process with database-operation
context and omit only Copilot results, so Claude and Gemini projects remain
usable. Failures must not produce fabricated projects or sessions.
Locked-database handling uses SQLite's normal read behavior and a five-second
busy timeout; it does not retry indefinitely.

Deletion of Copilot sessions is out of scope because this application must not
mutate Copilot's private session store. The delete control is hidden or disabled
for Copilot sessions.

## Compatibility

Use `better-sqlite3` for synchronous, read-only access. Rebuild its native module
for the Electron runtime alongside `node-pty`, and include its native files in
the existing unpacked application resources. Open the database with
`readonly: true`, `fileMustExist: true`, and a five-second busy timeout.

Claude and Gemini discovery and resume behavior remain unchanged.

## Testing

Automated tests cover:

- grouping Copilot sessions by normalized `cwd`
- project session count and last-activity calculation
- mapping session ID, title, timestamp, and branch
- zero-session launch with `copilot`
- one-session launch with `copilot --resume=<session-id>`
- multiple-session selection without terminal launch
- Recent Sessions attention trigger for multiple sessions
- session click generation of the exact Copilot resume command
- missing database and bounded database-error behavior
- Copilot session deletion being unavailable

Run the existing build after targeted tests to verify Electron bundling and type
safety.
