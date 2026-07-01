# Canvas Calc Roadmap

This roadmap reflects the current app after comparing it with the early MVP
draft. The important lesson from that draft is not to replace the app's
architecture; it is to keep the product contract crisp: structured math tokens,
explicit links, clear unresolved states, local persistence, and no silent data
loss while editing.

## Done

These parts of the original expression-editor roadmap are now shipped and
covered by tests:

- Pure calculation engine with precedence, parentheses, decimals, unary signs,
  division, formatting, strict paste parsing, link resolution, definitions, and
  cycle checks.
- Engine-owned diagnosis for unresolved expressions:
  `missing-operator`, `unmatched-open`, `unmatched-close`, `empty-parens`,
  `broken-link`, `source-unresolved`, and `divide-by-zero`.
- Soft unresolved result rendering: broken expressions show `?` plus an engine
  message when the repair is known.
- Drag-to-link inserts at a resolved position instead of replacing existing
  terms, with a visible drop caret and invalid-zone feedback.
- Paste honors the selected term or missing-operator gap instead of always
  appending.
- Keyboard link creation with `L`, including cancel and cycle refusal.
- Copy/paste preserves live links within the same session when the source is
  still safe; otherwise copied links freeze to a number.
- Source deletion is guarded: deleting a linked-from block confirms and freezes
  dependents; deleting a referenced number freezes dependent term links.
- Link rules are locked in across pointer, keyboard, shortcuts, copy/paste, and
  deletion paths: pending results cannot start result links, own-block/cycle
  links are refused, and unsafe copied links freeze to constants.
- Structured text export is available from the overflow menu for a selected
  block or the whole canvas, using stable `@block#token` references for support
  and debugging.
- The variables sidebar includes selected-block health: status, unresolved
  reason, link count, direct sources, and direct dependents.
- Multi-canvas state, per-canvas undo/redo, local autosave, PWA precache, and
  offline reload coverage.
- Mobile/touch regression coverage for phone-sized drag/link placement.

## Current Product Contract

- Expressions are stored as structured terms, not plain strings.
- A block result can be linked only when it is a real resolved result.
- A number term can be linked directly; that link follows the number term until
  the source term is deleted, then it freezes to the last safe value.
- Link insertion never overwrites an existing term.
- Keyboard linking, result-key shortcuts, and drag/drop share the same resolved
  result and self-link guards.
- Links that would make a result depend on itself are refused.
- Unresolved dependents explain whether the link is broken or whether the linked
  source needs to be fixed first.
- Structured exports are one-way clipboard/debug artifacts. Paste still accepts
  normal arithmetic text only; importing structured exports is not part of the
  current contract.
- Selecting a block and opening the sidebar shows its local health and immediate
  dependency neighbourhood.
- App data stays local. The shipped app has no runtime dependencies, build step,
  backend, account system, or app-data network calls.

## Next Slice: Named Values Polish

Make the existing variables sidebar more useful before adding larger product
surface:

- clearer names for result versus number rows
- stable ordering for named values and unnamed results
- quick rename paths that stay keyboard-accessible
- empty-state and unresolved-state checks for the sidebar

Keep this focused on the current sidebar. Do not add spreadsheet-style formula
management or cross-canvas references yet.

## Later Product Bets

Choose only one larger product direction at a time:

- richer named values and variable management
- lightweight chart blocks
- freeform note blocks
- import/export
- functions such as `sqrt`, `%`, `min`, and `max`
- optional formula autocomplete

Recommended order: polish named values next, then revisit which wishlist items
would make the calculator meaningfully more useful without bloating the core
interaction model.

## Maintenance Rules

- Keep the shipped app dependency-free.
- Prefer pure-module tests for engine, editing, state, history, store, and
  sidebar logic.
- Use Playwright for browser wiring, touch geometry, persistence, and offline
  behavior.
- When a shipped file listed in `sw.js` changes, update `ASSET_REVISION` and keep
  `test/sw.test.js` passing.
- Keep docs aligned with real behavior; avoid roadmap entries that describe
  already-shipped work as future work.
