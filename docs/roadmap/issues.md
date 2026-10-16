=== Command palette: search commands, terminals and notes | enhancement,area:ux,priority:high
**Original behavior**
A keyboard-driven search palette ranks commands, terminals, notes and other nodes as you type. It also has pick modes (ask / check / connect) that reuse the same search to choose a target terminal or node for an action.

**Today in OrchestrAI**
No palette. Navigation is by mouse, Alt+[ / Alt+], or the minimap.

**Proposed scope**
- Ctrl+K opens a palette with fuzzy search over: commands (new terminal, tidy, connect, minimap, settings...), every node on every floor (jump + select + center), floors (switch), roles and presets.
- Pick mode: reusable `pickNode({kind?})` used by "connect to...", "send note to...", Maestro helpers.
- Recent items first; Enter runs, Esc closes.

**Acceptance criteria**
- [ ] Ctrl+K opens and Esc closes the palette; focus returns to the previous element.
- [ ] Typing ranks matches (exact > prefix > fuzzy) across nodes on all floors.
- [ ] Choosing a node switches floor, selects it and centers the view.
- [ ] Commands are discoverable and show their shortcut.
- [ ] Covered by an automated UI test.

=== Peer-to-peer agent messaging between connected terminals | enhancement,area:agents,priority:high
**Original behavior**
Terminals joined by a rope can talk to each other: an agent can list its connected peers, ask a peer a question and wait for the answer, or check a peer's progress. Rope activity is highlighted while a message transfers.

**Today in OrchestrAI**
Only a Maestro terminal can use the `orchestrai` CLI, and only the conductor can send/read. Notes can push text through a rope with the play button. Non-Maestro agents cannot message their neighbours.

**Proposed scope**
- Give every terminal a scoped bridge token that is limited to terminals it is connected to (rope = permission).
- `orchestrai peers`, `orchestrai ask <peer> <text>` (waits for the peer to go quiet and returns its new output), `orchestrai check <peer>`.
- Highlight the rope while a message is in flight (reuse `flashRope`).
- Keep Maestro as the superset that can address any terminal.

**Acceptance criteria**
- [ ] A terminal can only reach peers it is connected to; unconnected targets are rejected.
- [ ] `ask` returns the peer's response text or a timeout error.
- [ ] Rope visibly animates during the exchange.
- [ ] Tests cover allowed, denied and timeout paths.

=== Routines: scheduled commands and reminders | enhancement,area:agents,priority:high
**Original behavior**
A Routines panel lets you schedule a command or prompt for an agent (one-off or recurring), run it now, enable/disable it, and see a history of past runs. Maestro terminals can create routines.

**Today in OrchestrAI**
Nothing scheduled. Floor hooks run only on floor creation and before landing.

**Proposed scope**
- Routine = { name, target terminal or new terminal, text/command, schedule (once, every N minutes, cron-like daily/weekly), enabled }.
- Scheduler in the main process so routines fire while the window is hidden (tray).
- History list with time, outcome and a snippet; "Run now"; enable toggle.
- `orchestrai routine add/list/remove` for Maestro terminals.

**Acceptance criteria**
- [ ] A recurring routine fires on schedule and types into its target.
- [ ] Missed runs while the app was closed are not replayed silently (shows "missed").
- [ ] History persists across restarts and can be cleared.
- [ ] Unit tests for schedule calculation.

=== Pull request integration for floors | enhancement,area:git,area:floors,priority:high
**Original behavior**
Floors can be created from a pull request and followed through its host CLI (gh / glab). The app opens PRs, checks status, pushes, merges, removes merged floors and can open the PR on the website. No token is stored; it uses the host CLI's own login. Git hosts are configurable.

**Today in OrchestrAI**
Floors are isolated worktrees that land by local merge only.

**Proposed scope**
- "New floor from PR" (number or URL) -> fetch branch into a worktree.
- Floor menu: Push, Open PR, PR status (checks, review state), Merge, "Land via PR" instead of local merge.
- Host detection from `origin`; GitHub via `gh`, GitLab via `glab`; show a clear message when the CLI is missing or not logged in.

**Acceptance criteria**
- [ ] Create a floor from an existing PR and see its diff files.
- [ ] Push and open a PR from a floor.
- [ ] PR status badge on the floor tab, refreshed on focus.
- [ ] Never stores credentials.

=== Persistent terminal sessions (tmux) | enhancement,area:terminal,priority:high
**Original behavior**
Terminals can run inside tmux ("keeps running after the app quits"), including a configurable tmux socket name and a "keep remote processes alive" option for SSH; reconnecting attaches to the same session. Terminals can offer to resume.

**Today in OrchestrAI**
Closing the app kills every shell. Only the scrollback text is restored.

**Proposed scope**
- Per-terminal "Keep running after quit" for Local (tmux), WSL and SSH.
- Reattach on next start; show "Restored" status.
- Detect tmux availability and explain when it is missing; honour a custom socket name.
- A setting to disable the feature globally.

**Acceptance criteria**
- [ ] A long-running command survives an app restart and the terminal reattaches.
- [ ] Missing tmux is detected and reported, not silently ignored.
- [ ] Closing the node (not the app) kills the tmux session.

=== Rich notes: markdown editor, preview, images, colors | enhancement,area:notes,priority:high
**Original behavior**
Notes are markdown with an edit/preview toggle, images attached from the clipboard or drag and drop, a color per note, code block / table / diagram (mermaid) copy actions, and notes can be backed by a file on disk (including remote files that refresh).

**Today in OrchestrAI**
A plain textarea that stores text in the workspace.

**Proposed scope**
- Edit / Preview toggle with a markdown renderer (sanitised) and syntax-highlighted code blocks.
- Paste or drop images; store under app data and reference by relative path.
- Note color; copy buttons on code blocks.
- Optional "link to file": the note edits a real `.md` file and follows external changes.

**Acceptance criteria**
- [ ] Preview renders headings, lists, tables, code and images safely (no script execution).
- [ ] Pasted images persist after restart.
- [ ] File-backed notes save to disk and reload on external change.

=== Install skills for agents so they know the orchestrai CLI | enhancement,area:agents,priority:high
**Original behavior**
Before starting an agent, the app installs its own skills and CLI into the target environment (including a selected user in a container or WSL) so the agent can use the canvas tools without being told. Settings has Roles and Skills tabs.

**Today in OrchestrAI**
Maestro mode types a text primer into the agent after it starts. Nothing is installed for Claude Code / Codex, and WSL/SSH/Docker terminals get no CLI.

**Proposed scope**
- Ship an `orchestrai` skill (SKILL.md) for Claude Code and an AGENTS.md snippet for Codex/others; install into the user's agent config dir on demand, with a visible "Installed" state and uninstall.
- For WSL/Docker, copy the CLI and expose the bridge through a reachable address (opt-in, token-scoped).
- Replace the typed primer where a skill is installed.

**Acceptance criteria**
- [ ] One-click install/uninstall of the skill for Claude Code.
- [ ] Installation never overwrites existing user files without a backup.
- [ ] Settings shows what is installed where.

=== Config files editor: CLAUDE.md and AGENTS.md with sync | enhancement,area:agents,priority:high
**Original behavior**
A sheet manages the project's agent config files (CLAUDE.md and AGENTS.md): shows whether each exists, lets you create, edit and delete them (delete goes to the trash), reports whether they hold the same content, and syncs one over the other after asking which version to keep.

**Today in OrchestrAI**
These files can be edited in a Files node only.

**Proposed scope**
- Floor menu -> "Config files...": status of both files, character counts, Create / Edit / Delete (trash).
- "In sync / Different / Only one exists" indicator with a Sync action and a conflict dialog showing which side is overwritten.
- Refuse to overwrite if either file changed on disk since it was read.

**Acceptance criteria**
- [ ] Create, edit, delete and sync work on a floor's directory.
- [ ] Sync with differing content requires an explicit choice of winner.
- [ ] Stale-write protection is tested.

=== Workspaces: a level above floors with a sidebar | enhancement,area:platform,priority:high
**Original behavior**
The app has multiple workspaces (each with its own floors, default directory and connection), listed in a sidebar. Workspaces can be created, renamed, duplicated, reordered, switched with shortcuts, exported/imported and deleted. Undo/redo is grouped across workspace-level operations.

**Today in OrchestrAI**
One workspace; floors are the only grouping. Whole-workspace export/import exists.

**Proposed scope**
- Data model: `workspaces[] -> floors[]`; migrate existing data into one workspace.
- Sidebar (collapsible) with workspace list, create/rename/duplicate/reorder/delete.
- Shortcuts to cycle workspaces; per-workspace default shell and folder.
- Export/import a single workspace.

**Acceptance criteria**
- [ ] Existing saved state migrates without loss.
- [ ] Switching workspaces keeps terminals alive.
- [ ] Single-workspace export/import round-trips.

=== Cross-floor connections | enhancement,area:canvas,area:floors,priority:medium
**Original behavior**
A rope can connect nodes that live on different floors (and workspaces). The far end shows a "Go to <name> on <floor>" affordance, and stale ends show "Floor removed / Agent removed".

**Today in OrchestrAI**
Ropes only connect nodes on the same floor. The Maestro `new --floor` flag creates a terminal elsewhere without a rope.

**Proposed scope**
- Allow Connect to target a node on another floor (pick via the command palette).
- Render a stub on each floor with the remote node's name and a jump link.
- Handle deletion of either end gracefully.

**Acceptance criteria**
- [ ] A note on floor A can send to a terminal on floor B through a cross-floor rope.
- [ ] Deleting either end removes or marks the rope; no errors.
- [ ] Undo/redo restores the connection.

=== Groups: named, colored containers for nodes | enhancement,area:canvas,priority:medium
**Original behavior**
Nodes can be grouped into a named group with a color; groups can be renamed, recolored and ungrouped.

**Today in OrchestrAI**
Multi-select moves nodes together but there is no persistent grouping.

**Proposed scope**
- Ctrl+G groups the selection into a frame node; Ctrl+Shift+G ungroups.
- Frame has a title, color, resize and collapses its bounds to fit members.
- Moving the frame moves members; tidy respects groups.

**Acceptance criteria**
- [ ] Group, rename, recolor, ungroup.
- [ ] Group membership survives save/load and undo.

=== Note stacks (Fichario): stack notes into tabbed piles | enhancement,area:notes,priority:medium
**Original behavior**
Notes can be stacked into a named pile ("Fichario") that shows one note at the front with tabs. Notes can be added, moved between stacks, spilled back onto the canvas, and the stack can set a uniform color.

**Today in OrchestrAI**
No stacking.

**Proposed scope**
- Drag a note onto another to stack; tab strip to switch front note.
- Rename stack, uniform color toggle, spill/unstack, delete keeping notes.

**Acceptance criteria**
- [x] Stack, reorder, move between stacks, spill.
- [x] Persistence and undo support (stack data lives in node.data).

=== Drawing: full toolset and shape recognition | enhancement,area:canvas,priority:medium
**Original behavior**
Drawing tools: pen, brush, smart draw (recognizes shapes and snaps them), arrow, highlighter, line, rectangle, ellipse, plus grouping of strokes. Drawings live directly on the canvas rather than inside a node.

**Today in OrchestrAI**
A Drawing node with pen, 7 colors, 5 widths, eraser, undo, clear.

**Proposed scope**
- Add arrow, line, rectangle, ellipse, highlighter and brush tools.
- Smart draw: recognize a rough rectangle / ellipse / line / arrow and replace the stroke.
- Optional free-floating canvas drawing layer (not tied to a node).
- Select, move and delete individual shapes.

**Acceptance criteria**
- [x] All tools render and persist.
- [x] Smart draw converts a rough rectangle, ellipse, line and arrow.
- [x] Shapes can be selected and moved.

=== Prompter: compose prompts with @mentions, file index and attachments | enhancement,area:agents,priority:medium
**Original behavior**
A composer for talking to agents: mention terminals, floors and files, attach images and files, collapse long pasted text into a chip, and deliver the composed prompt to the chosen agent.

**Today in OrchestrAI**
Notes can send plain text; the Chat node has a simple box.

**Proposed scope**
- Composer popover (from a note or a keybinding) with `@` autocomplete for terminals, floors and files (indexed from the floor directory).
- Paste images/files as attachments saved to a temp folder and referenced by path.
- Long paste collapses to "Pasted text #n (N lines)".
- Deliver to one or several terminals.

**Acceptance criteria**
- [x] `@` completion for files, terminals and floors.
- [x] Attachments are written to disk and referenced in the prompt.
- [x] Delivery works to a terminal (chat node uses the same send hook, not separately tested).

=== Chat face for terminals and conversation history | enhancement,area:agents,priority:medium
**Original behavior**
A terminal can show a "Chat" face instead of the raw terminal (and can start in chat mode), with threads, searchable history, attachments, unread/attention marks and an interrupt button.

**Today in OrchestrAI**
The Chat node runs a CLI per message; there is no thread list, no history search, and it is separate from terminals.

**Proposed scope**
- Face toggle on a terminal node: Terminal / Chat.
- Persisted threads per terminal, searchable, with load-older paging.
- Interrupt, clear thread, attachments, unread indicator.

**Acceptance criteria**
- [x] Toggle between faces without losing the process.
- [x] Search across threads returns highlighted results.

=== Agent usage tracking (limits and consumption) | enhancement,area:agents,priority:medium
**Original behavior**
An "Agent Usage" view shows consumption and limits per agent provider, refreshable, with a viewer and editable/bundled provider definition files and detection of a missing CLI.

**Today in OrchestrAI**
None.

**Proposed scope**
- Provider definitions (JSON) describing how to query usage for Claude Code, Codex, etc.
- Usage panel with refresh, last updated time, and "CLI not found" state.
- Surface a warning on terminals nearing limits.

**Acceptance criteria**
- [x] At least Claude Code and Codex providers.
- [x] Failure to query shows an actionable message.

=== Accounts: multiple subscriptions or API keys per agent CLI | enhancement,area:agents,priority:medium
**Original behavior**
Run several agents of the same CLI side by side, each on its own subscription or API key. A terminal starts on its account at next launch. Accounts can be added, renamed, signed out, moved to default, and use custom endpoints.

**Today in OrchestrAI**
All terminals share the user's environment.

**Proposed scope**
- Account = isolated config directory / env vars per provider.
- Account picker in the terminal sheet; sign-in flow in a terminal.
- Store API keys in the OS keychain, never in `workspace.json`.

**Acceptance criteria**
- [ ] Two Claude Code terminals on different accounts at once.
- [ ] Keys are stored in the keychain only.

=== Floor management: duplicate, status, snapshots, landing preview and test | enhancement,area:floors,priority:medium
**Original behavior**
Floors can be copied (when safe), carry a status, take snapshots, and show a landing preview with a "test landing" dry run. Creating an isolated floor reports seeding progress; removal shows progress and can fail with a reason. Floors can have different kinds. Hooks have named sections with run history and live output.

**Today in OrchestrAI**
Create, rename, land (with file diff + check), discard; single setup/check hook.

**Proposed scope**
- Duplicate floor (layout without processes, optionally with a new worktree).
- Status text/badge per floor (settable by agents through the CLI).
- Dry-run landing (merge in a temporary worktree) showing conflicts before landing.
- Hook sections with history and streamed output instead of a single command.
- Progress UI for create/remove.

**Acceptance criteria**
- [ ] Dry-run reports conflicts without touching the base checkout.
- [ ] Hook runs are listed with output and exit code.

=== Portal: user agent, storage scope, design mode, local file reload | enhancement,area:portal,priority:medium
**Original behavior**
Portals offer user-agent presets (default, desktop, mobile, custom, with a warning that it can break sign-in), a storage scope (isolated / workspace / global), a "design" mode that captures a page region or picked element with annotations to hand to an agent, and auto-reload of local file sources. A portal can be roped to a terminal.

**Today in OrchestrAI**
Basic webview with address bar, back/forward, reload, devtools, one shared session.

**Proposed scope**
- Settings per portal: user agent preset, storage scope, name.
- Design mode: select element/region -> screenshot + selector + annotations -> send to a connected terminal.
- Watch a local HTML file/directory and reload on change.
- Rope portal <-> terminal so the agent can read/drive it.

**Acceptance criteria**
- [ ] Scope changes isolate cookies.
- [ ] Captured region is delivered to a connected terminal as an image path.

=== Connections: circuit routing, manage panel and cable ties | enhancement,area:canvas,priority:low
**Original behavior**
Ropes can be drawn as elbowed "circuit" routes as an alternative to hanging cables, a Manage Connections panel lists/removes connections (with Remove All), and cable ties pin a rope to the canvas.

**Today in OrchestrAI**
Hanging verlet ropes only; remove one at a time via the chip.

**Proposed scope**
- Routing setting: cable (current) or circuit (orthogonal with rounded corners).
- Connections panel per node and global.
- Optional pins that hold a rope point at a position.

**Acceptance criteria**
- [ ] Switching routing re-renders all ropes.
- [ ] Panel lists, removes one and removes all.

=== File tree: tabs, media viewer, icon grid, content search, file clipboard | enhancement,area:files,priority:medium
**Original behavior**
The file tree has an editor pane with tabs, media tabs for images/PDF/video, an icon grid view, filename and content search, a file clipboard (copy/cut/paste files), reveal and copy path actions, watch-state with retry, and git status integrated (with attach-checkout).

**Today in OrchestrAI**
Tree with git badges, filename search, create/rename/trash, a plain textarea editor with Save.

**Proposed scope**
- Editor tabs with dirty markers; syntax highlighting (CodeMirror 6) and markdown mode.
- Image/PDF/video preview tabs served through a restricted protocol.
- Grid view; content search (ripgrep when available).
- Copy/cut/paste files between folders and from the OS clipboard.
- Watcher failure state with Retry.

**Acceptance criteria**
- [ ] Multiple tabs, dirty indicator, save all.
- [ ] Image and PDF preview.
- [ ] Content search returns file, line and snippet.

=== Git node: push/pull, merge preview, conflicts, stash apply, history graph | enhancement,area:git,priority:medium
**Original behavior**
Git actions run with progress and cancel, show a merge preview, list stashes and history with per-commit file diffs, show the full commit body, and handle a stale index lock.

**Today in OrchestrAI**
Branches, stage/unstage/discard, diff, commit, log, stash push/pop.

**Proposed scope**
- Fetch / pull / push with progress and cancel.
- Merge branch with a preview and conflict list; open conflicted files.
- Commit details view (body, files, diffs); stash list with apply/drop.
- Detect and offer to remove a stale `index.lock`.

**Acceptance criteria**
- [ ] Push/pull on a repo with a remote.
- [ ] Merge preview lists conflicts before merging.
- [ ] Commit details show per-file diffs.

=== Open in IDE | enhancement,area:ux,priority:medium
**Original behavior**
The app lists installed IDEs, lets you choose a preferred one per workspace, and opens a folder or file in it.

**Today in OrchestrAI**
Only "Reveal in Explorer".

**Proposed scope**
- Detect VS Code, Cursor, JetBrains, Zed, etc.
- "Open in <IDE>" in floor menu, file tree and git node; preferred IDE setting.

**Acceptance criteria**
- [ ] Detects at least VS Code and Cursor on Windows.
- [ ] Opens the floor folder and a specific file.

=== Docker sandboxes | enhancement,area:terminal,priority:medium
**Original behavior**
Beyond `docker exec`, terminals can run in a Docker Sandbox: choose an existing sandbox (matching the workspace first), create a new one for a project (agent, host workspace, clone mode), test the connection, and see policy denials with a suggested fix command. Multiple terminals may share a sandbox and the app never deletes it.

**Today in OrchestrAI**
Docker containers via `docker exec -it` only.

**Proposed scope**
- Sandbox picker and create flow in the terminal sheet.
- Connection test with diagnostics (copyable).
- Respect and display policy denials.

**Acceptance criteria**
- [ ] List, create and attach to a sandbox.
- [ ] Failed tests show a copyable diagnostic.

=== Layout templates (Partituras): save, update, export and insert canvas arrangements | enhancement,area:canvas,priority:medium
**Original behavior**
A "Partitura" is a reusable canvas arrangement that can be created from a selection, updated, listed, exported (one or all), imported from files and inserted onto a canvas.

**Today in OrchestrAI**
Only whole-workspace export/import and undo.

**Proposed scope**
- Save selection as a template (nodes, ropes, positions, commands, roles; no scrollback).
- Template library with insert, update, delete, export/import `.json`.
- Variables (e.g. working directory) filled when inserting.

**Acceptance criteria**
- [ ] Save a 3-terminal setup and insert it on another floor.
- [ ] Export/import round-trip.

=== Link nodes and drag-and-drop files or URLs onto the canvas | enhancement,area:canvas,priority:medium
**Original behavior**
A Link node represents a URL or file (open, open in a portal, copy URL). Files and images can be dropped or pasted onto the canvas and become nodes/attachments.

**Today in OrchestrAI**
Nothing is created from drops.

**Proposed scope**
- Drop a URL -> Link node (open in Portal action); drop a file -> Link/File node; drop an image -> image node or note attachment.
- Paste handling on the canvas.

**Acceptance criteria**
- [ ] Dropping a URL and a file creates the right node.
- [ ] Open / copy actions work.

=== Terminals overview panel with attention list | enhancement,area:ux,priority:medium
**Original behavior**
A Terminals list shows every terminal with status (idle / starting / running / exited), marks ones that need attention or are active, and jumps to them.

**Today in OrchestrAI**
Per-node status dot and attention pulse only.

**Proposed scope**
- Collapsible panel listing terminals across floors with status, role and unread/attention.
- Click to jump; badge count on the toolbar and tray.

**Acceptance criteria**
- [ ] Panel stays in sync with status changes.
- [ ] Attention badge clears when the terminal is focused.

=== Remote control from a phone or tablet | enhancement,area:platform,priority:low
**Original behavior**
A remote feature pairs devices (pairing window, passcode, tailnet-only option, port), lists connected devices with presence, assigns each a role, and can stream camera frames and previews.

**Today in OrchestrAI**
None.

**Proposed scope**
- Optional authenticated web UI over the local network / tailnet with explicit pairing.
- View terminal output and send input, approve actions, receive attention notifications.
- Off by default; revoke device; no cloud relay.

**Acceptance criteria**
- [ ] Pairing requires a one-time code.
- [ ] Revoking a device ends its session immediately.
- [ ] Threat model documented before release.

=== Device portal: streaming screen and automation contract | enhancement,area:device,priority:low
**Original behavior**
Android devices stream their screen as frames, publish active sessions, and expose an automation contract so agents can drive them.

**Today in OrchestrAI**
Screenshot polling every second; tap/swipe/keys/text/launch and a UI element list.

**Proposed scope**
- Continuous streaming (scrcpy or `screenrecord` pipe) at a useful frame rate.
- Document an automation API (via the orchestrai CLI) so a connected agent can tap, type, screenshot and read the UI tree.
- Emulator lifecycle (list AVDs, start/stop).

**Acceptance criteria**
- [ ] >= 10 fps stream on a local emulator.
- [ ] CLI commands for tap/type/screenshot.

=== Theme system: custom terminal themes, light/dark pairs, installed-font picker | enhancement,area:terminal,priority:low
**Original behavior**
Terminal themes include System, Dark, Light and Custom; a light and a dark theme can be paired and switched with the system; a font picker lists installed monospace fonts with a live preview and "use default".

**Today in OrchestrAI**
Five built-in themes and a free-text font field.

**Proposed scope**
- Custom theme editor (colors, import from common formats).
- Pair a light and dark theme.
- Installed monospace font list (via `queryLocalFonts`) with preview.

**Acceptance criteria**
- [ ] Custom theme saved and applied live.
- [ ] Font picker only lists monospace fonts.

=== Preferences: customizable shortcuts and localization | enhancement,area:ux,priority:low
**Original behavior**
Settings has General, Terminal and Shortcuts tabs; every action's keyboard shortcut is reassignable. The UI is localized into many languages with a language setting.

**Today in OrchestrAI**
Fixed shortcuts; English only.

**Proposed scope**
- Shortcut registry with conflict detection and reset.
- Extract UI strings to a catalog (i18next or similar) and ship English plus Portuguese as the first additional locale.

**Acceptance criteria**
- [ ] Rebind and persist a shortcut.
- [ ] Language switch changes all visible strings.

=== App lifecycle: crash recovery, diagnostics, onboarding and auto-update | enhancement,area:platform,priority:low
**Original behavior**
A renderer-fault screen reassures that terminals keep running and offers Reload; a diagnostic report can be saved; first-run onboarding explains the canvas and floors; updates are checked and installed with release notes; the window has custom controls.

**Today in OrchestrAI**
No recovery UI, no onboarding, no updater, native title bar.

**Proposed scope**
- Error boundary that keeps ptys alive and reloads the renderer.
- "Save diagnostic report" (versions, platform, logs; no secrets).
- 3-step onboarding.
- Updates via electron-updater once releases exist.

**Acceptance criteria**
- [ ] Simulated renderer crash shows the recovery screen and terminals survive.
- [ ] Diagnostic report contains no tokens or file contents.

=== Storage management: location, usage and delete-all | enhancement,area:platform,priority:low
**Original behavior**
Settings can show where data is stored, move it, show usage, reveal backups, delete a backup, and delete all data / clear global portal storage.

**Today in OrchestrAI**
Fixed location in Electron userData; backups listed but not deletable; no usage view.

**Proposed scope**
- Storage tab: location (reveal), usage by category, move location, delete individual backups, clear portal storage, delete all with confirmation.

**Acceptance criteria**
- [ ] Usage numbers match disk.
- [ ] Moving storage migrates data and restarts cleanly.

=== Project: commit the automated end-to-end tests and run them in CI | project,priority:high
**Context**
Feature behavior is currently verified by throwaway Electron scripts kept outside the repo (canvas, ropes, floors/landing, history, terminals, terminal sheet, Maestro CLI).

**Proposed scope**
- Move the scripts into `tests/e2e/` with a small shared harness (isolated userData dir, wait helpers, real input events).
- `npm test` runs them headless where possible; Windows CI job on GitHub Actions.
- Unit tests for pure logic (rope geometry, schedule math later, command-line parsing).

**Acceptance criteria**
- [ ] `npm test` passes locally.
- [ ] CI runs on every PR.
- [ ] Flaky checks are quarantined with an explanation.

=== Project: packaging, installers and cross-platform verification | project,priority:medium
**Context**
Only run from source on Windows has been exercised. macOS/Linux code paths (shells, tray, resolveCommand) are untested.

**Proposed scope**
- electron-builder config: Windows installer, macOS dmg, Linux AppImage; app icon.
- Verify node-pty prebuilds, `orchestrai` CLI on PATH and tray on each OS.
- Document requirements (Node, git, optional adb, tmux).

**Acceptance criteria**
- [ ] Installer for Windows builds and launches.
- [ ] Smoke test on macOS and Linux documented.

=== Project: add LICENSE, contributing guide and screenshots | project,priority:high
**Context**
`package.json` declares MIT but the repository has no LICENSE file; the README has no screenshots.

**Proposed scope**
- Add MIT LICENSE, CONTRIBUTING.md (how to run the tests, code style, how features are verified).
- README screenshots/GIFs of the canvas, floors, terminal sheet and ropes.
- Note that the project is independent and not affiliated with similar products.

**Acceptance criteria**
- [ ] LICENSE present and matches package.json.
- [ ] README has at least three screenshots.
