# OrchestrAI

A spatial canvas terminal workspace for AI agents (Electron + xterm.js + node-pty).

    npm install
    npm start

If you launch from a VS Code or Claude Code shell, unset `ELECTRON_RUN_AS_NODE` first.

## Canvas
- Pan: drag the background. Zoom: wheel or the `-`/`+` buttons.
- Move a node: drag its header, or Alt+drag anywhere on it. Double-click the title to rename.
- Select several: Ctrl+click, Shift+click a header, or Shift+drag a box. `Ctrl+A` selects all. Dragging moves the whole group. `Delete` removes the selection.
- **Connect**: select a node, press `C` (or the Connect button / the link button on its header), then click another node. `Esc` cancels. Hover a rope and click `x` to remove it. Ropes are dashed, sag and swing, and light up when a note sends text through them.
- **Tidy** (`T`): arranges the selection, or all nodes. **Minimap** (`M`).
- **Undo / redo**: `Ctrl+Z`, `Ctrl+Shift+Z` / `Ctrl+Y` for nodes, ropes and layout. Undoing a closed terminal opens a fresh shell in its place.
- `Alt+]` / `Alt+[` cycle nodes, `Ctrl+PageDown` / `Ctrl+PageUp` cycle floors, `?` lists every shortcut.

## Floors
Tabs under the toolbar. Each floor is its own canvas with its own working directory. On a git repository a floor can be **isolated**: a git worktree on a new `orchestrai/...` branch. The tab menu (`⋮`) offers:
- **Hooks**: a *setup command* (typed into a terminal when the floor opens, or on demand) and a *check before landing* (runs in the floor's directory; a non-zero exit blocks landing until you press Land again to confirm).
- **Land**: review every changed file and its diff, optionally commit pending work, merge with `--no-ff` (aborting cleanly on conflict), then remove the worktree and branch.
- **Discard**: delete the worktree and branch.

## Terminal sheet (New / Edit Terminal)
**+ Add > Terminal** opens the sheet; **right-click a terminal** (body or header) > *Terminal settings…* edits an existing one.
- **Details**: name, command, *Runs on* (Workspace Default, Local with a chosen shell, WSL distro and user, SSH host/port/user, Docker container), working directory, **Monitor Activity** and **Maestro**. The **Quick start** row (Claude Code, Codex, Antigravity, OpenCode, Shell) fills in name, command and icon; presets are editable in Settings (up to 5 active).
- **Keep running after quit** (Details tab; Local, WSL and SSH): runs the terminal inside `tmux` so its processes survive closing the app. On the next start the app reattaches (status **Restored**) instead of starting a new shell, and does not retype the command or role. Closing the terminal node, or *Restart*, ends the tmux session. If `tmux` is not installed on that machine the terminal says so and starts normally. Settings can disable the feature globally and set the tmux socket name (default `orchestrai`, one `tmux -L` server shared by all terminals). Not available for Docker or custom profiles. On Windows, use WSL or SSH; native Windows has no tmux.
- **Appearance**: emoji icon, accent color (8 colors or custom), theme and font overrides, with a live preview. The font field has an **Installed fonts** list of monospace fonts, each previewed in its own face.
- **Role**: reusable roles (instructions for an agent). Starter roles are included; create, edit and delete your own. When the terminal has a command, the role text is pasted to the agent as its first message once it goes quiet after starting.
- **Monitor Activity**: each terminal shows a status dot (starting, running, idle, exited). When a burst of output ends and you are not looking at the terminal, its border pulses and, if the app is in the background, a desktop notification appears. Clicking the terminal clears it.
- **Maestro**: promotes a local terminal to a conductor. It gets the `orchestrai` command on its PATH:
  `orchestrai list | new --name N --command C [--role R] [--cwd DIR] | send <terminal> <text> | read <terminal> [--lines N] | close <terminal> | roles`.
  New terminals appear next to the Maestro, connected by a rope. The bridge listens on 127.0.0.1 only, with a per-run token that only Maestro terminals receive.

## Terminals overview
The **Terminals** toolbar button (or `L`) opens a panel listing every terminal on every floor with its status (starting, running, idle, restored, exited), floor and role. Terminals that need attention are listed first and counted in a badge on the button and in the tray tooltip. Click a row to jump to that terminal; focusing it clears its attention flag.

## Themes
In **Settings** (⚙): pick a theme (Follow system, Dark, Light, Midnight, Solarized dark, or your own). *Follow system* switches between the **Light theme** and **Dark theme** you choose, following the OS appearance. **Custom themes** has a color editor (background, text, cursor, selection, 16 ANSI colors) and **Import…**, which reads xterm.js / VS Code style JSON and Windows Terminal color schemes. Each terminal can override the theme and font in its Appearance tab.

## Terminals
- **Shell profile** (button in the terminal header): Windows PowerShell, PowerShell 7, Command Prompt, Git Bash, every WSL distro and running Docker container are detected. You can also run any command (`ssh me@host`, `python -i`) and set a start directory. Applying restarts that terminal.
- **Settings** (⚙ in the toolbar): font family and size (with an installed-font picker), line height, cursor style and blink, scrollback, themes (see above), default profile, copy on select, Windows-style Ctrl+C / Ctrl+V, restoring recent output after restart, persistent tmux sessions, and your own saved profiles.
- **Find** (Ctrl+Shift+F, or ⌕) with match count and case toggle. **Right-click** for Copy, Paste, Select all, Find, Clear, Restart. Ctrl+Shift+C / Ctrl+Shift+V always copy and paste. Links open in your browser.
- When a process exits the terminal says so and Enter restarts it (or use ⟳). The node border flashes on the terminal bell. Recent output is saved and shown again after restarting the app.

## Nodes
- **Terminal**, **Note** (▶ sends its text to linked terminals, chats and devices), **Drawing** (freehand pad).
- **Files**: tree with git badges, search, create/rename/trash, text editor (Ctrl+S).
- **Git**: branches, stage/unstage/discard, diffs, commit, history, stash.
- **Chat**: runs an agent CLI per message with the prompt on stdin (default `claude -p --continue`, editable per node).
- **Portal**: embedded browser with a persistent session.
- **Device**: Android emulator or phone over `adb` (needs `adb` on PATH or in the Android SDK).

## Workspace
The `⋯` button opens export / import, a backup list and the backups folder. A backup is written every 10 minutes when something changed, and on quit (last 20 kept). A tray icon offers Show / Hide / Quit.