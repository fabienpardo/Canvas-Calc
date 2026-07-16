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

- `sw-register.js`, `engine.js`, `state.js`, `sidebar.js`, `editing.js`, `input.js`, `history.js`,
  and `store.js` use a small UMD tail (`if (typeof module !== 'undefined') module.exports = …;
  else window.CanvasX = …`).
- `index.html` loads those modules with `<script>` tags (no build step), and
  `sw.js` precaches them.

**Engine surface (pure; no `document`/`window`):**
- `tokenize(block, map, stack)`, `evalTokens(tokens)`, `resolve(block, map)`
  and `createEvaluationMemo()` for render-scoped dependency reuse
- `fmt(v)`, `groupDisplay(raw)`, `parseExpression(text)`
- `createsCycle(...)`, `blockDefinition(block, map)`, `linkedValue/linkedSource`,
  `findTermByTid`, `diagnose(block, map)`
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
- A render-scoped evaluation memo resolves a shared linked source once, then a
  fresh memo observes the next edit
- Linked **number-term** reference resolves to that number's value
- Linked result source unresolved: dependent shows `?` with a source-fix reason
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

### Link rules
- Only resolved results can start result links through drag, keyboard linking,
  result-key shortcuts, or "continue from last result" shortcuts.
- Number terms can start term links, but keyboard and pointer flows refuse links
  back into the source block.
- Result cycles are refused; result-source deletion freezes dependents after
  confirmation; number-source deletion freezes dependent term links immediately.
- Same-session copied links stay live only while the source is still safe for
  the paste target; otherwise they freeze to the copied value.
- Dependents of unresolved linked results show the source-fix message instead of
  a silent `?`.

### Structured export
- Selected-block export emits a one-way debug format with `Canvas Calc Block v1`,
  stable `@block#token` references, status/result, dependency neighbourhood, and
  token details.
- Canvas summary export emits `Canvas Calc Summary v1` with one formula line per
  block.
- Structured export is not accepted by paste/import; normal copy/paste remains
  value-based and paste-friendly.

### Integration (jsdom or preview)
- `renderBlock` emits expected chips + colored linked chips; `drawLinks` endpoints
- Sidebar lists all variables/results (named + unnamed), inline value edit recomputes
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
  number-link exemption, missing-source, source-unresolved diagnosis),
  formatting, strict clipboard parsing, definitions; `test/state.test.js` —
  saved-state migration, normalization, id repair, lookups; `test/editing.test.js` — expression editing reducers
  (selected insertion, operator replacement, backspace chain, linked unlink,
  active typing, sign toggle including negative entry starters, parenthesis
  deletion/selection); `test/input.test.js` — input controller wired to
  the real editing/engine modules (digit/operator entry, `=` finish, clear/delete
  routing, operator replace, result→linked block, paste, selection text, backspace
  chain, invalid paste no-op, `±` empty/after-operator/result selection,
  parenthesis deletion, link-rule contracts for unresolved result shortcuts,
  own-block keyboard links, no-active operator continuation, and structured
  block/canvas export formatting);
  `test/sidebar.test.js` — sidebar helpers including strict sidebar number
  parsing and block-health summary helpers; `test/history.test.js` — undo/redo stacks (snapshot, undo, redo,
  empty-stack no-ops, per-canvas isolation); `test/store.test.js` — view-state
  round-trips and `commit()` ordering/opt-outs (snapshot→mutate→render→save);
  `test/sw.test.js` — service-worker
  precache (incl. `sw-register.js`, `app.js`, `state.js`, `engine.js`, `sidebar.js`, `render.js`,
  `interactions.js`, `canvases.js`, `editing.js`, `input.js`, `history.js`, and
  `store.js`), asset-revision hash guard, `res.ok` guard, non-GET and
  unsupported-scheme requests ignored, Canvas Calc-only cache cleanup, and
  current-cache-scoped reads; `test/sw-register.test.js` covers registration
  timing and the single-reload upgrade handoff.
- **E2E (Playwright, shared `e2e/helpers.js`):**
  - `e2e/app.spec.js` — block create / `=` re-anchor, precedence + parens,
    live separators, drag + undo-restore, drag-to-link + color, plus-minus
    negative entry / result negation, sidebar inline edit and numeric
    validation, selected-block-free sidebar behavior, snap-aligned canvas grid
    toggle, zoom + scroll, paste, invalid
    paste feedback, structured export menu copy, single-click label,
    selected-term editing hints, keyboard
    add/menu/term selection basics, backspace chain.
  - `e2e/editing.spec.js` — insert-after-select, operator replacement,
    parenthesis select/delete, linked unlink, empty-block delete, undo/redo
    (typing, delete, clear, paste, redo, redo-stack-cleared).
  - `e2e/linking.spec.js` — result→operator link, before/after insertion
    when dropping onto a number chip, stable source colors, light/dark contrast,
    matching drag-ghost styling, unresolved-result refusal, same-session copy/paste
    live-link preservation, source-unresolved dependent explanation, cycle-rejection
    dialog, neutral own-source drag cancel, Escape pointer-drag cancel,
    pointer-cancel cleanup/reversion, delete-source-with-dependents warning and
    cancel path.
  - `e2e/persistence.spec.js` — old-state load + tid migration, default
    zoom/grid, restored zoom/grid, pagehide save flush, corrupt +
    malformed-but-valid localStorage survive.
  - `e2e/canvases.spec.js` — multi-canvas isolation/switch, per-canvas zoom,
    rename persistence, delete + fallback, multi-canvas persistence, migration,
    and cancellation/freezing of transient links across canvas boundaries.
  - `e2e/layout.spec.js` — compact launch toolbar/icons, zoom control pinned on
    scroll; canvas behind keypad, sidebar closes the keypad, bounded canvas
    scroll space.
  - `e2e/mobile.spec.js` — mobile (iPhone 16 Pro Max-size viewport) smoke,
    viewport fit, long-expression caret follow, Done result reveal, sidebar
    blur/keypad close, inert hidden controls, hidden-panel input blur,
    linked-chip selection visuals, and touch link-drop insertion.
- **CI:** `.github/workflows/test.yml` runs unit + e2e.

### Backlog (nice to have)
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
- Block and clear-all deletes run without confirm prompts and rely on undo; canvas delete keeps a confirmation because canvases are not undoable
- `+` button anchored to the lowest block (matched typing/drop placement)
- Backspace chain clears → deletes → steps left
- `±` starts negative entry in empty/after-operator slots and can negate a selected result locally
- Parentheses can be selected and deleted directly
- Sidebar numeric inputs reject malformed values instead of saving parseFloat-like prefixes
- Pending edits flush to localStorage on pagehide before the debounce window ends
- The visible grid is drawn on the scaled canvas at the same 20px interval as snapping
- Selected terms show a visible insertion cue and editable-name affordances
- Invalid pasted expressions show feedback and do not mutate the canvas
- Empty-state add, overflow-menu navigation, and term selection have keyboard smoke coverage
- Links stay attached at non-1 zoom
- Service worker no longer caches error responses
- Service worker ignores unsupported request schemes such as browser-extension URLs
