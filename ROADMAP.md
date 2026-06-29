# Canvas Calc — Expression Editor Roadmap

This roadmap turns the prioritized issue list into a sequenced, code-grounded
plan. It is organized into **phases** rather than a flat priority list, because
several P1 items share one foundation: a single pure "diagnosis" function in the
engine that explains *why* a block is unresolved. Building that first unblocks
the whole P1 parentheses + explanation cluster.

Each phase notes the concrete files it touches, the design decisions it forces,
and how it is tested. Priorities (P1/P2/P3) from the original list are preserved
in the per-item tags.

---

## Guiding design decisions (resolve before/while doing Phase 0–1)

These cut across multiple rows and should be agreed up front:

1. **Tolerant → strict-with-explanation.** Today the engine is deliberately
   *tolerant*: `evalTokens` (`engine.js`) ignores unmatched `(`, skips stray
   `)`, and treats empty `()` as `0`; `=`/blur auto-closes open parens via
   `editing.js:balanceParens`. The new P1 rules ask for `?` + a reason instead.
   **Recommendation:** keep auto-closing open parens on *commit* (`=` / leaving a
   block) so a finished block still self-heals, but while a block is *actively
   being edited* surface `?` + reason. Stray `)` and empty `()` are never
   auto-healed, so they always surface as unresolved.
2. **One reason, one message, one place.** All "unresolved" reasons should be
   produced by the engine (pure, testable) and merely *rendered* by the view.
   No reason strings or detection logic in `render.js`.
3. **Insert, never replace (drag + paste).** Drag-drop and paste both currently
   have replace/append-only behavior. The target model for both is: resolve a
   precise insertion index, glue with operators, never destroy an existing term.

---

## Phase 0 — Diagnosis foundation (keystone for P1)

A single pure engine function powers every "show `?` and explain why" row.

**New in `engine.js`:**

- `parenStatus(terms)` → `{ open, stray }`. Today `unmatchedOpenParens` counts
  only unmatched `(` and *ignores* stray `)` (closers below depth 0). Split it so
  stray closers are reported too.
- Empty-paren detection: a `(` immediately followed by `)` in the token stream.
- Divide-by-zero signal: `evalTokens` currently computes `v / 0 = Infinity`.
  Add a sentinel (e.g. return `DIVZERO`, mirroring the existing `MALFORMED`
  pattern) so the reason can be reported instead of rendering `∞`.
- `diagnose(block, map)` → `{ status, value, reason, message }` where
  `status ∈ {ok, incomplete, unresolved}` and `reason` is one of the codes
  below. `incomplete` = still mid-edit (show `·`, no scary message);
  `unresolved` = a real problem (show `?` + message).

**Reason → message table (P1):**

| reason            | message                                      |
| ----------------- | -------------------------------------------- |
| `missing-operator`| Add an operator between these values.        |
| `unmatched-open`  | Close the parenthesis to calculate.          |
| `unmatched-close` | Remove or match the closing parenthesis.     |
| `empty-parens`    | Add a value inside the parentheses.          |
| `broken-link`     | Linked value is no longer available.         |
| `divide-by-zero`  | Cannot divide by zero.                        |

**Tests:** extend `test/engine.test.js` — one case per reason code, plus the
`incomplete` vs `unresolved` boundary (e.g. `5 +` is incomplete, `5 ) ` is
unresolved-stray).

---

## Phase 1 — Parentheses correctness (P1)

Depends on Phase 0. Pure-engine + render only; no interaction changes.

- **Unmatched `(` → `?`.** `diagnose` returns `unmatched-open` while editing;
  commit still auto-closes (per decision #1).
- **Unmatched / stray `)` → `?`.** New `parenStatus.stray > 0` → `unmatched-close`.
- **Empty `()` → `?` (was `0`).** `evalTokens` `parseFactor` stops returning `0`
  for an empty group; `diagnose` returns `empty-parens`. *(Design-decision row in
  the original list — this is the decision: unresolved, not 0.)*

**Tests:** engine cases + an `e2e/editing.spec.js` flow typing `(`, `)`, `()`.

---

## Phase 2 — Unresolved result explanations (P1)

Depends on Phase 0. This is the view layer for the diagnosis.

- Render the `?` result with an attached **soft explanation**: a small caption
  under/beside the result pill (and `title`/`aria-describedby` for a11y), driven
  entirely by `diagnose().message`. Touches `render.js` result block
  (`hasResultSlot` branch ~ lines 359–393) and `blockSig` (~83–93) so the
  reason is part of the reconciliation signature.
- Wire the remaining reasons that aren't parens: `missing-operator` (already
  detected, now gets a message), `broken-link` (`linkedValue` returns `null` for
  a missing source), `divide-by-zero` (from the Phase 0 sentinel).
- "Soft" styling: muted, non-alarming; not the red destructive treatment.

**Tests:** `e2e` assertions that each broken state shows the expected message;
unit coverage of the message lives in Phase 0.

---

## Phase 3 — Drag-and-drop safety (P1)

All in `interactions.js`. The current drop handler (`pointerup`,
~lines 217–253) **replaces a number** when you drop on it (`tb.terms[idx] =
newLink()`). Rework to the insert model.

- **Never replace an existing term.** Remove the number-swap branch; always go
  through an insert-before/after path (`insertLinkBefore` already exists and
  glues with `+`).
- **Resolve a precise insertion index** for every target type:
  - number → insert before/after (whichever half of the chip you're over).
  - operator → insert around it, not over it.
  - linked term → insert next to it.
  - `?`/missing-op gap → insert into the gap only if it produces a valid expr.
- **Visible drop tracking + caret.** Add an insertion-caret element shown during
  `pointermove` at the resolved index (extend `nearbyInsertionTerm` /
  `dropTargetAt`, which already compute candidate indices). Replaces the current
  whole-term `slot-target` highlight as the primary affordance.
- **Soft invalid-zone highlight.** When the resolved drop is invalid (e.g. cycle,
  or no valid gap), show a soft "not here" state instead of an ambiguous drop.
  The cycle path already exists (`flashCycle`); extend to non-cycle invalids.

**Tests:** `e2e/linking.spec.js` — drop on number/operator/linked/gap each assert
*insertion* (term count grows, original term survives) and caret visibility.

---

## Phase 4 — Paste at selection (P1)

`input.js:pasteText` currently always appends to the active block. Make it honor
the current selection/gap, reusing the Phase 3 insertion-index logic so paste and
drag share one "insert terms at index" primitive.

- Insert parsed terms before/after the selected term, or into a selected gap.
- Fall back to append when there is no selection (current behavior).

**Tests:** `test/input.test.js` — paste with a number selected, an operator
selected, a gap selected, and nothing selected.

---

## Phase 5 — Dependency integrity & core accessibility (P1)

- **Deleting a linked-from source number** can silently leave dependents
  unresolved (they then read `null` → `?`). Add a guard: detect dependents
  (the `createsCycle`/`deps` walk in `engine.js` is the model to reuse for a
  reverse-dependency lookup) and warn via the existing `confirmDialog` before
  destructive delete, or convert dependents to a `broken-link` state explicitly.
  Touches `input.js` delete paths + `engine.js` (a `dependentsOf` helper).
- **Keyboard-accessible link creation.** Link creation is pointer-only today
  (all in `interactions.js` `pointerdown`/`pointerup`). Add a keyboard flow:
  select a result/number → a "link to…" command → choose a target slot. Touches
  `input.js` (key handling) + `render.js` (focus/roving tabindex on terms).

**Tests:** unit for `dependentsOf` + delete guard; `e2e` keyboard-only link.

---

## Phase 6 — P2 batch

- **Copy preserves links (P2).** `input.js:expressionText` flattens linked terms
  to numeric values. Add a structured clipboard format (e.g. JSON term payload on
  a custom MIME, with the current plain text as fallback) so paste within the app
  can rebuild live links.
- **Linked-number ± semantics (P2, design risk).** Pressing ± on a linked number
  mutates the *source* (`input.js` `neg` → `linkedSourceNumber`). Intentional but
  surprising; at minimum surface a hint, or offer "negate locally" vs "negate
  source."
- **Result negation toggle (P2).** Repeated ± on a result keeps spawning new
  `-1 * (…)` blocks (`input.js` `neg` result branch). Detect an existing negation
  block and toggle it instead.
- **Undo/redo scope + Ctrl+Y (P2).** `history.js` covers calculation/block state
  only. Extend snapshots to grid, text size, zoom, canvas title, settings; add
  the missing Ctrl+Y redo binding in `input.js`.
- **Accessibility — block move by keyboard (P2)** (`interactions.js` drag is
  pointer-only); **menu ARIA** cleanup (mixed menu/radio-group) in
  `canvases.js`/`render.js`; finish keyboard-complete term editing actions.
- **Discoverability (P2).** Promote drag-to-link beyond the hidden gesture (the
  added tip is partial); make selected-term semantics more legible.
- **Offline/PWA E2E (P2).** Add a browser-level offline-reload test exercising
  `sw.js`.
- **iOS/WebKit (P2).** Add a WebKit Playwright project in `playwright.config.js`.

---

## Phase 7 — P3 polish

- **± inline style (P3).** Replace `style="grid-column: span 2;"` on the ± key
  with a class in `styles.css`.
- **Modern-CSS compatibility (P3, accepted).** `:has()` / `color-mix()` are fine
  for modern browsers; document the support floor in `README.md`. No change
  unless a broader-compatibility target is set.

---

## Sequencing summary

```
Phase 0 (engine diagnosis)  ──┬─► Phase 1 (parens)
                              └─► Phase 2 (explanations)
Phase 3 (drag safety) ────────► Phase 4 (paste, shares insert primitive)
Phase 5 (integrity + a11y core)
Phase 6 (P2 batch)  ─►  Phase 7 (P3 polish)
```

Phases 0–2 are the highest-leverage block: one engine function plus its view
wiring closes seven P1 rows. Phases 3–4 share a single "insert at index"
primitive and should be built together. Each phase is independently shippable
and test-gated (`npm test` for pure modules, `npm run test:e2e` for wiring).
