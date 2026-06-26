# Canvas Calc

A freeform calculator canvas for mobile. Instead of one running tape, you build
calculations as blocks on a canvas and link results together — change a number
anywhere and every dependent result updates live.

Single-page, zero-dependency, offline-capable PWA. No build step, no framework,
no network calls.

## Features

- **Freeform canvas** — tap empty space to drop a calculation where you want it;
  drag blocks to rearrange. Type without tapping and blocks stack top-left.
- **Live expressions** — full PEMDAS, unlimited terms per block.
- **Linked numbers** — a result selected + an operator starts a new linked block;
  or long-press a result and drag it onto another block's number, onto a block, or
  onto empty canvas. Linked values update and cascade automatically.
- **Edit anything** — tap a number to select and retype; results recompute instantly.
- **Labels** — name any block.
- **Undo / redo**, adjustable text size, clear all.
- **Auto-save** to the device (localStorage). Single canvas, restored on reopen.
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

On desktop, the number keys, operators, `.`, Backspace, and Cmd/Ctrl+Z (and
Shift for redo) all work for quick testing.

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
top: `const CACHE = 'canvas-calc-v1';`. When you change any file, bump that
version (`v2`, `v3`, …) so returning visitors get the new build instead of the
cached one.

## Files

| File | Purpose |
|------|---------|
| `index.html` | The entire app — markup, styles, logic. |
| `manifest.webmanifest` | PWA metadata (name, icons, standalone display). |
| `sw.js` | Service worker; offline caching. |
| `icon-192.png`, `icon-512.png` | App icons. |
| `icon-maskable-512.png` | Maskable icon (Android adaptive masks). |
| `apple-touch-icon.png` | iOS home-screen icon. |
| `favicon-32.png` | Browser tab icon. |
| `.nojekyll` | Tells GitHub Pages to skip Jekyll processing. |

## Notes & limitations

- **Fonts are system fonts** (San Francisco on iOS, Roboto on Android) so the app
  stays fully offline with no font downloads. To use specific typefaces, add them
  and cache them in `sw.js`.
- **Link lines** redraw when a block drag ends, not continuously during the drag.
- Tested: evaluation engine (PEMDAS, linked cascade, deep chains, cycle
  protection) and the build/select/link/cascade flow. Touch-geometry behaviours
  (drag-to-link drop accuracy, drag positioning, tap-to-place, long-press delete)
  need a real device.
# Canvas-Calc
