# Testing strategy — Canvas Calc

## Principles

- **The shipped app stays zero-build, zero-dependency, offline.** All test tooling
  is dev-only — never imported by `index.html`, never added to the service-worker
  precache.
- **Spend effort where the risk is.** The expression engine and editing model are
  pure, deterministic, and the highest-value correctness surface — test them hard.
  The pointer / render / zoom layer is fragile but expensive to unit-test — cover
  it with a small number of real-browser smoke tests, not exhaustive specs.
- **Every fixed bug earns a regression test.** We already have a concrete list
  (see the bottom of this doc) — those become the first tests.

## Test pyramid

1. **Unit (most)** — pure engine: evaluation, formatting, clipboard parsing,
   cycle detection, term mutations. Fast, deterministic, no DOM.
2. **Integration (some)** — model + DOM behavior (render output, sidebar, copy/
   paste, single-click edit). jsdom, or the live preview harness.
3. **E2E smoke (few)** — a real browser for touch geometry the unit tests can't
   reach: drag, drag-to-link drop accuracy, pinch/zoom math, scrolling.

## Core structure: pure modules

The no-DOM logic is split into importable browser/Node modules, so the same files
run in the shipped app and under `node --test`:

- `engine.js`, `state.js`, `editing.js`, `input.js`, `history.js`, and `store.js`
  use a small UMD tail (`if (typeof module !== 'undefined') module.exports = …;
  else window.CanvasX = …`).
- `index.html` loads those modules with `<script>` tags (no build step), and
  `sw.js` precaches them.

**Engine surface (pure; no `document`/`window`):**
- `tokenize(block, map, stack)`, `evalTokens(tokens)`, `resolve(block, map)`
- `fmt(v)`, `groupDisplay(raw)`, `parseExpression(text)`
- `createsCycle(...)`, `blockDefinition(block, map)`, `linkedValue/linkedSource`,
  `findTermByTid`
- editing reducers operate on passed-in blocks/arrays and return selection
  changes instead of touching module globals.

**Determinism note:** locale separators are read from `Intl` at runtime. Make
them injectable (pass `{group, decimal}`, default `,`/`.`) so formatting tests
don't depend on the CI machine's locale.

## Tooling

- **Unit/integration runner:** Node's built-in `node:test` + `node:assert/strict`.
  No `npm install`. Run with `node --test test/`.
- **E2E (optional):** Playwright (`npx playwright test`), dev-only. Reuse the
  patterns already proven during development: build an expression by dispatching
  `pointerdown` on `.padgrid .key[data-k=…]`, read `.result.textContent`, simulate
  a block drag, simulate two-pointer pinch.
- **CI:** GitHub Actions — `node --test` on every push/PR (fast, required);
  Playwright as a separate, optional job.

## Local commands

```bash
npm ci
npm test
npx playwright install chromium
npm run test:e2e
```

## Unit test catalog (the core)

### Evaluation
- Precedence: `2+3*4=14`, `2*3+4*5=26`
- Parentheses: `(2+3)*4=20`, nested `2*(3+(4-1))=12`
- Left-assoc division: `10/2/5=1`
- Sign / negatives: `5 + (-8) = -3`
- Tolerant editing states: `"5 +"` → 5; empty parens `()` → 0; leading operator ignored
- Division edge: `1/0` → `"∞"`; `0/0` → `"—"` (NaN, **not** ∞ — regression)
- Linked result cascade: `A=10`, `B=A*2 ⇒ 20`; set `A=20 ⇒ B=40`
- Linked **number-term** reference resolves to that number's value
- Cycle detection: direct `A↔B` refused; **number-term links are never cycles**
- Deep chain resolves; self-reference returns `null`

### Formatting
- `fmt`: locale grouping, integers vs decimals, trailing-zero trim, `∞`/`—`
- `groupDisplay` in-progress: `1234→1,234`, `1234.→1,234.`, `1234.50→1,234.50`,
  `-1234→-1,234`, `''→0`

### Clipboard parsing (`parseExpression`)
- `"1,234 + 5*(2)"` → terms → evaluates to `1244`
- Glyph normalization `× ÷ −`; sign-minus vs operator-minus; strips group
  separators; rejects unsupported or malformed pasted text instead of silently
  skipping characters

### Model mutations
- Backspace chain: `55 → 5 → 0(empty) → deleted → prev operator → deleted → prev number`
- Insert-after-selected: `[5,+,7,+,2]`, select `7`, press `- 4` ⇒ `5+7-4+2=10`
- `blockDefinition` renders labels: `total = A + B × C`

### Integration (jsdom or preview)
- `renderBlock` emits expected chips + colored linked chips; `drawLinks` endpoints
- Sidebar lists all variables (named + unnamed), inline value edit recomputes
- Grid toggle, single-click caption edit, copy/paste events

### E2E smoke (Playwright)
- `+` creates a block; type → live result; `=` finishes and re-anchors `+`
- Drag moves a block **and undo restores the original position**
- Drag-to-link creates a color-matched link
- Zoom buttons + pinch change scale; links stay attached; horizontal scroll exists

## What NOT to test

Exact pixels, CSS values, icon binaries, or the `renderAll` DOM plumbing. Don't
chase coverage on rendering — assert behavior and computed values, not markup.

## Status

### Implemented
- **Unit (`node --test`):** `test/engine.test.js` — evaluation
  (precedence, parens, division, negatives, tolerant states, div-by-zero,
  linked cascade, number-term links, cycle detection incl. indirect +
  number-link exemption, missing-source), formatting, strict clipboard parsing,
  definitions; `test/state.test.js` — saved-state migration, normalization,
  id repair, lookups; `test/editing.test.js` — expression editing reducers
  (selected insertion, operator replacement, backspace chain, linked unlink,
  active typing, sign toggle); `test/input.test.js` — input controller wired to
  the real editing/engine modules (digit/operator entry, `=` finish, clear/delete
  routing, operator replace, result→linked block, paste, selection text, backspace
  chain); `test/history.test.js` — undo/redo stacks (snapshot, undo, redo,
  empty-stack no-ops, per-canvas isolation); `test/store.test.js` — view-state
  round-trips and `commit()` ordering/opt-outs (snapshot→mutate→render→save);
  `test/sw.test.js` — service-worker
  precache (incl. `app.js`, `state.js`, `engine.js`, `render.js`,
  `interactions.js`, `canvases.js`, `editing.js`, `input.js`, `history.js`, and
  `store.js`), asset-revision hash guard, `res.ok` guard, non-GET ignored,
  old-cache cleanup.
- **E2E (Playwright, 44 specs, shared `e2e/helpers.js`):**
  - `e2e/app.spec.js` — block create / `=` re-anchor, precedence + parens,
    live separators, drag + undo-restore, drag-to-link + color, sidebar inline
    edit, grid toggle, zoom + scroll, paste, single-click label, backspace chain.
  - `e2e/editing.spec.js` — insert-after-select, operator replacement, linked
    unlink, empty-block delete, undo/redo (typing, delete, clear, paste, redo,
    redo-stack-cleared).
  - `e2e/linking.spec.js` — result→operator link, drop onto a number slot,
    cycle-rejection dialog, delete-source-with-dependents warning.
  - `e2e/persistence.spec.js` — old-state load + tid migration, default
    zoom/grid, restored zoom/grid, corrupt + malformed-but-valid localStorage survive.
  - `e2e/canvases.spec.js` — multi-canvas isolation/switch, per-canvas zoom,
    rename persistence, delete + fallback, multi-canvas persistence, migration.
  - `e2e/layout.spec.js` — zoom control pinned on scroll; canvas behind keypad.
  - `e2e/mobile.spec.js` — mobile (Pixel 7) smoke + viewport fit.
- **CI:** `.github/workflows/test.yml` runs unit + e2e.

### Backlog (nice to have)
- Split the variables sidebar out of `render.js` if future UI work makes that
  module painful to change.
- Make `fmt` separators injectable (today only `groupDisplay`/`parseExpression`
  are; `fmt` uses `Intl` with the runtime locale — tests read `NUM_GROUP` to stay
  robust, but decimals/spaces could still vary across environments).
- A WebKit Playwright project (iOS Safari fidelity for the PWA).
- `data-testid` hooks if styling-class churn starts breaking selectors.
- Offline reload assertion after SW install.

## Regression seeds (bugs already fixed — turn each into a test)

- NaN rendered as `∞` → now `—`
- Fast keypad taps dropped (now `pointerdown`, not `click`)
- Drag undo lost the original position (snapshot now on first move)
- `setPointerCapture` on a detached node after `renderAll`
- Block, canvas, and clear-all deletes run without confirm prompts and rely on undo where available
- `+` button anchored to the lowest block (matched typing/drop placement)
- Backspace chain clears → deletes → steps left
- Links stay attached at non-1 zoom
- Service worker no longer caches error responses
