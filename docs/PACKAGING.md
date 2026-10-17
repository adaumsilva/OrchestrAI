# Packaging and platform notes

## Requirements
- Node.js 20 or newer and npm (for building and for running from source).
- git on `PATH` (floors, worktrees, the Git node, pull requests).
- Optional: `gh` or `glab` (pull requests), `tmux` (terminals that keep running after quit), `adb` (Device node), Docker with the `docker sandbox` command (Docker Sandboxes), `rg` (faster content search).
- Linux builds compile `node-pty` during `npm ci`, so they need `build-essential` and `python3`. Windows and macOS use the prebuilt binaries that ship with `node-pty`.

## Build
```
npm ci
npm run pack          # unpacked app in dist/ (fast, good for checking)
npm run dist:win      # NSIS installer + zip
npm run dist:mac      # dmg + zip   (run on macOS)
npm run dist:linux    # AppImage + deb   (run on Linux)
npm run smoke         # starts the packaged app once and checks it works
```
Installers are built by [electron-builder](https://www.electron.build/) from the `build` section of `package.json`. The icon is `build/icon.png` (regenerate with `npm run icon`). Builds are unsigned: Windows SmartScreen and macOS Gatekeeper will warn until you add a certificate (`CSC_LINK`, `CSC_KEY_PASSWORD`, `WIN_CSC_LINK`, notarization settings).

The workflow `.github/workflows/build.yml` builds, tests and smoke-tests all three platforms, uploads the installers as artifacts, and publishes a GitHub release when you push a tag such as `v0.2.0`. The release feed it creates (`latest*.yml`) is what in-app updates read.

## What the packaged app has to get right
- **The `orchestrai` command.** Terminals get `bin/` on their `PATH`. Inside `app.asar` external programs cannot run files, so `bin/` and `node-pty` are listed in `asarUnpack` and `main.js` rewrites the path to `app.asar.unpacked`. The shim runs the app's own executable with `ELECTRON_RUN_AS_NODE=1`, so no separate Node is needed.
- **node-pty.** Its native module, the Windows ConPTY helper (`OpenConsole.exe`, `winpty-agent.exe`) and its console-list helper script are unpacked too.
- **Data location.** User data lives in the Electron `userData` folder (`%APPDATA%/orchestrai`, `~/Library/Application Support/orchestrai`, `~/.config/orchestrai`) and survives upgrades. See Settings > Storage.

## Smoke test
`npm run smoke` (or `node scripts/smoke-packaged.js <path-to-executable>`) launches the packaged app with a throwaway profile and checks, from inside the app, that the interface loads, a terminal runs `echo`, and `orchestrai help` runs from the packaged files. It prints a JSON result and exits non-zero on failure. On headless Linux run it as `SMOKE_ARGS=--no-sandbox xvfb-run -a npm run smoke`.

### Status of platform checks
| Platform | Package | Smoke test | Notes |
| --- | --- | --- | --- |
| Windows 11 x64 | built (unpacked, NSIS installer) | passed on the unpacked build | The installer itself was built but not run on the development machine. |
| macOS | configured, built in CI | runs in CI | Not run by hand. Tray, `zsh` login shells and the dmg are unverified until CI reports. |
| Linux | configured, built in CI | runs in CI under xvfb | Not run by hand. Tray support depends on the desktop environment (AppIndicator). |

When you run the smoke test on macOS or Linux, add the result here.

## Known platform differences
- **Shell profiles** come from `/etc/shells` on macOS and Linux and from PowerShell, cmd, Git Bash and WSL on Windows (`src/services/shells.js`).
- **Tray.** On Linux the tray needs an AppIndicator-capable shell; without it the app still works but cannot hide to the tray.
- **tmux persistence** works natively on macOS and Linux and through WSL on Windows.
- **Command resolution.** `resolveCommand()` in `main.js` only applies on Windows (bare names and `.cmd` shims such as `npm`).
