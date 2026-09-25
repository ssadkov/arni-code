# Run Arni Code from source (Cursor)

This repository is the Arni Code editor, a VS Code fork. Chat signs in with Yandex and talks to the shared Arni backend. You do not need a GitHub Copilot subscription.

The first launch compiles the whole client. Plan a few hours and several gigabytes of disk. Later updates are a `git pull` plus a short recompile.

## What to install first (Windows)

- [Git](https://git-scm.com/)
- Node.js **24.18.0**, the version in `.nvmrc`. Put that exact version on `PATH` before opening the repo. [fnm](https://github.com/Schniz/fnm) or nvm-windows both work.
- Python 3
- Visual Studio 2022 Build Tools with the **Desktop development with C++** workload. `npm` builds native modules and fails without it.
- [Cursor](https://cursor.com/)

## Get the repository

```powershell
git clone https://github.com/ssadkov/arni-code.git
cd arni-code
git checkout main
```

In Cursor: **File → Open Folder** and choose the `arni-code` directory. Open this folder itself, not a parent directory.

## Launch from Cursor

1. Open **Run and Debug** (`Ctrl+Shift+D`).
2. In the configuration dropdown, select **VS Code**.
3. Press **F5**.

That compound runs the task `Ensure Prelaunch Dependencies` (`node build/lib/preLaunch.ts`), then starts `scripts\code.bat`. On a clean checkout the task installs dependencies (`npm ci` when `node_modules` is missing), downloads Electron into `.build\electron`, compiles when `out\` is missing, and fetches built-in extensions. The task output is quiet. If the window does not appear, open **Terminal → Run Task** output and wait until that task finishes. The first run is long.

The editor window is **Arni Code**. Its profile is `%USERPROFILE%\.vscode-oss-dev`, separate from Cursor and from a normal VS Code install. Sign in with your own Yandex account. Do not copy someone else's profile folder.

The main process starts paused until the debugger attaches. Leave the **VS Code** compound selected so the attach configurations start with it. If a breakpoint leaves the window frozen, press Continue in the Debug toolbar.

Launch without the debugger, from a terminal in the repo:

```powershell
.\scripts\code.bat --user-data-dir="$env:USERPROFILE\.vscode-oss-dev"
```

## Desktop shortcut that an agent can still watch

`scripts\arni-dev.cmd` starts the source build with the `.vscode-oss-dev` profile. Point a desktop shortcut at it. It skips `preLaunch`, because a shortcut does not get `node` from fnm or nvm, so compile from a terminal after a pull.

An agent does not need to launch the window itself to see it:

- console output goes to `%USERPROFILE%\.vscode-oss-dev\arni-dev-console.log`;
- the workbench logs are always under `%USERPROFILE%\.vscode-oss-dev\logs\<timestamp>\`;
- the renderer listens on CDP port `9222`, so Playwright can attach to the open window.

Only one dev window can hold port 9222 at a time.

## After git pull

```powershell
git pull
```

`preLaunch` compiles only when `out\` does not exist yet. It does not rebuild after a pull.

- Chat-only changes (`extensions/copilot`): `npm --prefix extensions/copilot run compile`, then **Developer: Reload Window** in the running Arni window.
- Editor changes (`src/`): `npm run compile`, then start **VS Code** again. `npm run watch` in a second terminal keeps the client and the chat extension rebuilding while you work.

Close Arni before a command that replaces `.build\electron`. A running window locks `runtime.node` and the download fails with `EPERM`.

## Shared free models

The default agent model is `nvidia/nemotron-3-ultra-550b-a55b:free`. Free-model requests on this backend share one daily budget across everyone using it. A long agent task spends that budget one model round at a time. A `429` that mentions `free-models-per-day` means the shared day is used up. It resets at 05:00 local time (00:00 UTC).
