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

## Enabling step (required, small): extract a pure engine

Today all logic lives in one IIFE inside `index.html`, so the functions can't be
imported. The one structural change this strategy needs is to pull the **no-DOM**
logic into `engine.js`:

- `index.html` loads it with `<script src="engine.js"></script>` (no build step),
  and it's added to the SW precache list.
- A small UMD tail (`if (typeof module!=='undefined') module.exports = …; else
  window.CanvasEngine = …;`) lets the *same file* run in the browser and under
  `node --test`.

This is deliberately **only the pure engine**, not the full module split the
reviewer suggested — it's small, low-risk, and unlocks ~70% of the value.

**Engine surface (pure — no `document`/`window`):**
- `tokenize(block, map, stack)`, `evalTokens(tokens)`, `resolve(block, map)`
- `fmt(v)`, `groupDisplay(raw)`, `parseExpression(text)`
- `createsCycle(...)`, `blockDefinition(block, map)`, `linkedValue/linkedSource`,
  `findTermByTid`
- term constructors (`newNumber`, …) and `deleteTermAndSelectPrev` reworked to
  operate on a passed-in block/array (return the new selection) instead of
  touching module globals.

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
  separators; ignores junk characters

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

## Rollout order

1. Extract `engine.js` (no behavior change) — confirm the app still runs.
2. `node:test` suite for evaluation + formatting + parsing (highest ROI).
3. Model-mutation tests (backspace chain, insert, definition).
4. Playwright smoke for the touch-geometry items above.
5. GitHub Actions workflow.

## Regression seeds (bugs already fixed — turn each into a test)

- NaN rendered as `∞` → now `—`
- Fast keypad taps dropped (now `pointerdown`, not `click`)
- Drag undo lost the original position (snapshot now on first move)
- `setPointerCapture` on a detached node after `renderAll`
- Empty block deletes without a confirm prompt
- `+` button anchored to the lowest block (matched typing/drop placement)
- Backspace chain clears → deletes → steps left
- Links stay attached at non-1 zoom
- Service worker no longer caches error responses
