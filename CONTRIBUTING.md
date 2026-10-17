# Contributing to OrchestrAI

Thanks for helping. Small, focused pull requests are easiest to review.

## Getting started
1. Fork and clone the repo, then `npm install` and `npm start`.
2. Pick an issue: [good first issue](https://github.com/adaumsilva/OrchestrAI/labels/good%20first%20issue) or [help wanted](https://github.com/adaumsilva/OrchestrAI/labels/help%20wanted). Comment on it so work is not duplicated.
3. Branch from `main`, make your change, open a PR that references the issue.

If your shell sets `ELECTRON_RUN_AS_NODE=1` (VS Code and Claude Code terminals do), `electron .` runs as plain Node. Unset it before `npm start`.

## Code layout
- `src/main.js`: window, tray, pty spawn/kill, workspace load/save, IPC. `src/preload.js` exposes `window.orchestrai` with channel allow-lists: add a prefix or event name there when adding IPC.
- `src/services/`: main-process services (`git`, `files`, `chat`, `device`, `data`, `shells`, `bridge`, `tray`). `bin/orchestrai.js` is the CLI used by Maestro terminals.
- `src/renderer/`: classic scripts, **load order matters** (see `index.html`). `core.js` has `h()`, `modal`, `popupMenu` and the `NodeKinds` registry; `kinds/*.js` are node types; `renderer.js` holds state, floors and the canvas.
- Add a node kind: `NodeKinds.x = { label, w, h, mount(ctx) }` in `kinds/x.js`, a script tag in `index.html`, and an icon in `KIND_ICONS`. `mount` returns a dispose function.
- State lives in `state.floors[]` and `state.settings`, persisted to `workspace.json` in the Electron userData folder. Keep scrollback out of `node.data`.

## Style
- Match the surrounding code: plain JavaScript, no build step, same naming and comment density.
- Run `node --check` on every JS file you edit.
- No new dependencies without discussion.

## Verifying changes
Check UI changes in the running app with real input. Run `npm test`: unit tests in `tests/unit/` run under plain node, and each `tests/e2e/*.test.js` runs in its own Electron process (`tests/e2e/entry.js`) against a temporary `userData` directory, driving the app with real input events and `executeJavaScript`. Add an e2e test next to the feature you change; `npm run test:e2e -- <name>` runs a subset. A check that proves flaky goes to `tests/quarantine/` with a comment saying why, never deleted silently. Describe in your PR how you verified the change.

## Originality
OrchestrAI is independent. Features are described in our own words in [docs/roadmap/issues.md](docs/roadmap/issues.md). Do not copy source code, assets or strings from other products.

## Security
Report vulnerabilities privately via GitHub security advisories rather than public issues.
