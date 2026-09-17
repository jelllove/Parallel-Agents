# Reproducible development environment

The application remains Windows-first. These tools prepare repository checks without reading
provider accounts or changing application source, runtime dependencies, or packaging behavior.

## Diagnostics and setup

```powershell
npm run doctor
npm --silent run doctor -- --json
npm run setup
```

Doctor derives Node/npm requirements from the manifest and Node pin, checks Git and lockfile
metadata, identifies platform boundaries, and distinguishes optional native/source-build tools.
It does not inspect provider credentials or install tools. Exit codes are `0` for ready, `1`
for missing prerequisites, and `2` for invalid CLI arguments.

Setup first checks prerequisites, then runs the locked installation:

```text
npm ci --include=dev --include=optional --ignore-scripts=false --no-audit --no-fund
npm run check
```

This is an explicit installation command: it downloads dependencies and permits their installation
scripts. It stops on failure and preserves the npm exit status. It does not install global tools,
source-rebuild node-pty, install Git hooks, change remote settings, or launch the desktop app.
Diagnostics time out after ten seconds; setup commands are bounded to fifteen minutes.

Windows users may invoke [scripts/setup.ps1](../scripts/setup.ps1) from another directory.
It delegates to the same npm setup contract, forwards arguments, and restores the caller's location.
It does not modify PowerShell execution policy; use the npm entry point if local policy disallows scripts.

Both Node CLIs support `--help` and `--npm-cli` with an absolute path to `npm-cli.js`.
When invoked through npm, they use the supplied npm executable path and run it through Node,
not by guessing how to execute `npm.cmd`. Direct Node invocation without that environment requires
the explicit CLI path. Repository-local Git environment is cleared before subprocesses.

## VS Code

The versioned [settings](../.vscode/settings.json),
[extension recommendations](../.vscode/extensions.json), and
[tasks](../.vscode/tasks.json) expose the existing validation commands.
They do not start application sessions or install hooks automatically.

## Optional non-GUI container

[The dev container](../.devcontainer/devcontainer.json) uses a
[digest-pinned Node 24 image](../.devcontainer/Dockerfile) with Git and a non-root user.
The source checkout is bind-mounted, while `node_modules`, `out`, and `reports` use separate volumes
so Linux dependencies and generated output do not overwrite a Windows host's corresponding directories.
Post-creation setup uses the same `npm run setup` contract.

The container sets `ELECTRON_SKIP_BINARY_DOWNLOAD=1`. It is for lint, types, tests, documentation,
and non-GUI build work; it is not a supported Linux desktop or native-packaging environment.
Do not remove that boundary or add provider credentials to make a desktop test run inside it.

The base image was built on a local Docker engine, and an offline real-npm fixture verified the
setup contract without changing its source/config/lockfile. The full application's container
installation/build was not executed as that verification. Native application qualification
continues to use the isolated Windows end-to-end and packaged-payload tests.
