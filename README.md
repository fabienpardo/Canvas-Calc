# Canvas Calc

A freeform calculator canvas for mobile. Instead of one running tape, you build
calculations as blocks on a canvas and link results together — change a number
anywhere and every dependent result updates live.

Single-page, zero-dependency, offline-capable PWA. No build step, no framework,
no network calls.

## Features

- **Freeform canvas** — add a calculation with the **+** button (it sits below the
  last block); drag blocks to rearrange. Typing with nothing active also starts a
  new block. Scroll in any direction; zoom with the on-canvas controls, Ctrl/
  trackpad-wheel, or pinch.
- **Live expressions** — full PEMDAS with parentheses, unary sign (±), and
  unlimited terms per block. Numbers show locale-aware thousand separators as you type.
- **Linked numbers** — select a result + an operator to start a new linked block,
  or drag any **result or input number** onto another block's number slot, onto a
  block, or onto empty canvas. Linked values cascade automatically, and each
  linked source gets its own color so references are easy to spot.
- **Edit anything** — tap a number to retype, tap an operator to swap it, and type
  an operator after a selected term to insert in the middle of an expression.
- **Labels & variables** — name any number or result (a result's name is its block
  title). The **𝑥** sidebar lists every variable, lets you edit values inline, and
  shows each result's definition in terms of labels (e.g. `total = A + B × C`).
- **Copy / paste** — copy a value or a whole expression; paste numbers or
  number+operator combos (desktop shortcuts or the ⋯ menu on mobile).
- **Undo / redo**, adjustable text size, grid toggle (off by default), clear all.
- **Multiple canvases** — keep separate sheets, each with its own title, zoom, and
  undo history; switch / rename / add / delete from the toolbar canvas menu.
- **Auto-save** to the device (localStorage), restored on reopen.
- **Cycle protection** — a link that would make a result depend on itself is refused.
- **Delete safety** — deleting a block that others link to warns first.

## Run locally

Any static file server works. Service workers require `http://` (or `https://`),
not `file://`, so open it through a server:

```bash
# from this folder
python3 -m http.server 8000
# then open http://localhost:8000 on your phone (same network) or desktop
```

On desktop, the number keys, operators, `.`, `(`, `)`, `=`/Enter, Backspace,
Cmd/Ctrl+C/V (copy/paste), and Cmd/Ctrl+Z (Shift for redo) all work for quick
testing.

## Deploy to GitHub Pages

1. Create a repo and push the contents of this folder to the root (or to a
   `/docs` folder).
2. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from
   a branch**, pick your branch and the folder you used.
3. Open the published URL on your phone. In the browser menu choose **Add to Home
   Screen** to install it as a standalone app.

`.nojekyll` is included so GitHub Pages serves every file as-is. All paths are
relative, so it works whether the site is at a domain root or a `/repo-name/`
subpath.

## Updating

The service worker (`sw.js`) precaches the app shell with a version string at the
top, like `const CACHE = 'canvas-calc-v10';`. When you change any file, bump that
version (`v10`, `v11`, ...) so returning visitors get the new build instead of the
cached one. (Navigations are network-first, so HTML updates land without a bump;
bumping guarantees cached assets refresh too.)

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell — markup, styles, UI/interaction logic. |
| `engine.js` | Pure calculation/formatting/parsing engine (no DOM; unit-tested). |
| `state.js` | Pure state normalization and lookup helpers (no DOM; unit-tested). |
| `render.js` | DOM rendering, link drawing, and variables sidebar helpers. |
| `interactions.js` | Canvas pointer, drag/link, long-press, wheel, and touch interaction wiring. |
| `canvases.js` | Multi-canvas switcher, rename, add, delete, and toolbar menu wiring. |
| `editing.js` | Expression editing reducers for digits, operators, deletion, and selection movement. |
| `input.js` | Keypad/keyboard input controller and copy/paste text (no DOM; unit-tested). |
| `manifest.webmanifest` | PWA metadata (name, icons, standalone display). |
| `sw.js` | Service worker; offline caching. |
| `test/`, `e2e/` | Unit tests (`node --test`) and Playwright e2e; see TESTING.md. |
| `icon-192.png`, `icon-512.png` | App icons. |
| `icon-maskable-512.png` | Maskable icon (Android adaptive masks). |
| `apple-touch-icon.png` | iOS home-screen icon. |
| `favicon-32.png` | Browser tab icon. |
| `.nojekyll` | Tells GitHub Pages to skip Jekyll processing. |

## Notes & limitations

- **Fonts are system fonts** (San Francisco on iOS, Roboto on Android) so the app
  stays fully offline with no font downloads. To use specific typefaces, add them
  and cache them in `sw.js`.
- **Link lines** redraw continuously during a block drag, at any zoom level.
- Tested: evaluation engine (PEMDAS, parentheses, linked cascade, deep chains,
  cycle protection) and the build/select/link/cascade flow. Touch-geometry
  behaviours (drag-to-link drop accuracy, drag positioning, pinch-zoom,
  long-press delete) are best confirmed on a real device.
