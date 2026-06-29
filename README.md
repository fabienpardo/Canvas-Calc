# Canvas Calc

Canvas Calc is a freeform calculator canvas for phone-sized screens and desktop
browsers. Instead of typing one long tape, you make movable calculation blocks,
link numbers between them, and let dependent results update as the canvas
changes.

The app is a static, offline-capable PWA:

- no framework
- no build step
- no runtime dependencies
- no backend or app-data network calls
- saved locally with `localStorage`

## What It Does

- **Freeform calculations:** add blocks anywhere on the canvas, drag them around,
  and zoom or pan the workspace.
- **Live math:** expressions support precedence, parentheses, decimals, unary
  sign, division, and in-progress editing states.
- **Linked values:** use one block's result, or one number inside a block, as an
  input somewhere else. Changes cascade through every dependent block.
- **Cycle protection:** links that would make a calculation depend on itself are
  rejected.
- **Variables sidebar:** label values and results, then inspect or edit them from
  the `x` sidebar.
- **Multi-canvas workspace:** keep separate canvases, each with its own title,
  blocks, zoom, and undo history.
- **Editing tools:** insert terms in the middle of an expression, replace
  operators, copy and paste expressions, undo and redo changes, resize text, and
  toggle the grid.
- **Installable PWA:** serve it over HTTP or HTTPS, then add it to the home
  screen on mobile.

## Quick Start

Use any static file server. Service workers do not run from `file://`, so open
the app through `http://localhost` or another HTTP origin.

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

For testing on a phone, make sure the phone and computer are on the same network,
then open the computer's local network address on port `8000`.

## Basic Use

- Tap `+` to create a calculation block.
- Type with the on-screen keypad, or use the hardware keyboard on desktop.
- Press `=` or Enter to finish the current block.
- Drag blocks to rearrange the canvas.
- Drag a result or number chip onto another number slot to create a link.
- Use the toolbar canvas menu to add, rename, switch, or delete canvases.
- Open the `x` sidebar to view named numbers and results.

Desktop shortcuts:

| Action | Shortcut |
| --- | --- |
| Enter numbers/operators | Number keys, `+`, `-`, `*`, `/`, `.`, `(`, `)` |
| Finish block | `=` or Enter |
| Delete/backspace | Backspace |
| Copy/paste | Cmd/Ctrl+C, Cmd/Ctrl+V |
| Undo/redo | Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z |
| Link without dragging | Select a result/number, press `L`, select a target, press `L` (Esc cancels) |

## Development

Install the dev-only test tooling:

```bash
npm ci
```

Run the fast unit suite:

```bash
npm test
```

Run the browser suite:

```bash
npx playwright install chromium
npm run test:e2e
```

Run everything:

```bash
npm run test:all
```

The shipped app does not use the npm dependencies. They are only for local and
CI verification.

## Test Coverage

The current suite is split between fast pure-module tests and a smaller real
browser suite:

- `test/engine.test.js` covers parsing, formatting, evaluation, linked values,
  definitions, cycles, and edge cases such as `NaN` and infinity.
- `test/state.test.js` covers saved-state migration and normalization.
- `test/editing.test.js` covers expression editing reducers.
- `test/input.test.js` covers keypad/keyboard input behavior.
- `test/history.test.js` covers per-canvas undo and redo.
- `test/store.test.js` covers view-state and commit ordering.
- `test/sw.test.js` covers the service-worker precache manifest and cache
  revision guard.
- `e2e/*.spec.js` covers the browser wiring: creating blocks, dragging, linking,
  persistence, multiple canvases, zoom/layout behavior, mobile viewport fit, and
  undo/redo flows.

More detail lives in [TESTING.md](TESTING.md).

## Project Structure

| Path | Purpose |
| --- | --- |
| `index.html` | Static app shell and script loading order. |
| `styles.css` | Layout, theme variables, blocks, keypad, sidebar, and responsive UI. |
| `app.js` | Application bootstrap and DOM wiring across the extracted modules. |
| `engine.js` | Pure math engine: parsing, formatting, resolving links, definitions, and cycle checks. |
| `state.js` | Pure saved-state normalization, migration, and lookup helpers. |
| `sidebar.js` | Variables sidebar rendering, grouping, and inline number/name editing. |
| `render.js` | DOM rendering, block reconciliation, and link drawing. |
| `interactions.js` | Pointer, drag, link-drop, long-press, wheel, pinch, and canvas interaction wiring. |
| `canvases.js` | Canvas menu behavior: switch, add, rename, and delete. |
| `editing.js` | Pure expression-editing reducers for digits, operators, deletion, selection, and sign toggles. |
| `input.js` | Keypad, keyboard, copy, and paste controller. |
| `history.js` | Per-canvas undo and redo stacks. |
| `store.js` | Shared view state plus the snapshot, mutate, render, and save commit policy. |
| `sw.js` | Offline cache and service-worker update strategy. |
| `manifest.webmanifest` | PWA name, scope, theme, display mode, and icons. |
| `test/` | Node unit tests. |
| `e2e/` | Playwright browser tests. |
| `.github/workflows/test.yml` | CI for unit and Playwright tests. |

## Offline Behavior

`sw.js` precaches the app shell, JavaScript modules, CSS, manifest, and icons.
HTML navigations are network-first so deployments are not hidden behind stale
cached pages. Static assets are cache-first and are refreshed when the service
worker revision changes. Runtime cache reads and cleanup are scoped to Canvas
Calc cache names so other apps on the same origin are left alone.

The unit test `test/sw.test.js` checks the cached asset list and revision hash.
If a shipped file changes without updating the service-worker revision, the test
fails.

## Deployment

Canvas Calc can be hosted by any static web server. GitHub Pages works without a
build step:

1. Push the repository contents to the branch or folder you want to publish.
2. In GitHub, open **Settings > Pages**.
3. Set the source to **Deploy from a branch**.
4. Choose the branch and folder that contain `index.html`.

The included `.nojekyll` file tells GitHub Pages to serve the files as-is. All
app paths are relative, so the app works from a domain root or a repository
subpath.

## Maintenance Notes

- Keep the shipped app dependency-free. Test tools belong in `package.json`, not
  in `index.html` or the service-worker precache.
- When a shipped file listed in `sw.js` changes, update `ASSET_REVISION` and keep
  `test/sw.test.js` passing.
- Keep new state migrations inside `state.js` so old `localStorage` payloads
  continue to load safely.
- Prefer unit tests for pure calculation, editing, state, history, and store
  behavior; use Playwright for browser wiring and interaction geometry.
