'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Editing = require('../editing.js');
const Engine = require('../engine.js');
const Input = require('../input.js');

// Build an in-memory app harness wired to the real Editing + Engine modules,
// so pressKey/pasteText exercise the same logic the browser runs (just no DOM).
function harness() {
  const canvas = { blocks: [], nextId: 1, nextTid: 1 };
  const state = {
    sel: { blockId: null, termIndex: null, kind: null },
    activeBlockId: null,
    saves: 0,
    renders: 0,
    snaps: 0,
    cleared: false,
    deletedRequests: []
  };

  function cur() { return canvas; }
  function byId(id) { return canvas.blocks.find((b) => b.id === id) || null; }
  function mapOf() { const m = {}; canvas.blocks.forEach((b) => { m[b.id] = b; }); return m; }
  function newBlock(x, y) {
    const b = { id: 'b' + (canvas.nextId++), x, y, label: '', terms: [] };
    canvas.blocks.push(b);
    return b;
  }
  function newNumber(value) { return { type: 'number', value, tid: 't' + (canvas.nextTid++) }; }
  function removeBlock(id) {
    canvas.blocks = canvas.blocks.filter((b) => b.id !== id);
    if (state.activeBlockId === id) state.activeBlockId = null;
  }

  const ctl = Input.create({
    Editing,
    cur,
    byId,
    blocksMap: mapOf,
    newBlock,
    newNumber,
    snap: (v) => v,
    nextSlot: () => ({ x: 40, y: 30 }),
    snapshot: () => { state.snaps++; },
    save: () => { state.saves++; },
    renderAll: () => { state.renders++; },
    // Mirrors store.commit: snapshot -> mutate -> render -> save (opt-out via opts).
    commit: (mutate, opts) => {
      opts = opts || {};
      if (opts.snapshot !== false) state.snaps++;
      mutate();
      state.renders++;
      if (opts.save !== false) state.saves++;
    },
    getSelection: () => state.sel,
    setSelection: (s) => { state.sel = { blockId: s.blockId, termIndex: s.termIndex, kind: s.kind }; },
    clearSelection: () => { state.sel = { blockId: null, termIndex: null, kind: null }; },
    getActiveBlockId: () => state.activeBlockId,
    setActiveBlockId: (id) => { state.activeBlockId = id; },
    removeBlock,
    deleteBlock: (b) => { state.deletedRequests.push(b ? b.id : null); },
    clearCanvas: () => { state.cleared = true; },
    linkedValue: Engine.linkedValue,
    parseExpression: Engine.parseExpression,
    createsCycle: (targetId, srcId) => Engine.createsCycle(targetId, srcId, mapOf()),
    freezeTermDependents: (blockId, tid, value) => {
      const v = parseFloat(value); const rv = isNaN(v) ? 0 : Math.round(v * 1e10) / 1e10;
      canvas.blocks.forEach((b) => {
        b.terms = b.terms.map((t) =>
          (t.type === 'linked' && t.sourceId === blockId && t.sourceTid === tid) ? newNumber(String(rv)) : t);
      });
    },
    setLinkStatus: (msg) => { state.linkStatus = msg; }
  });

  return { ctl, state, canvas };
}

function termSig(b) {
  return b.terms.map((t) => t.type + ':' + (t.type === 'linked' ? t.sourceId : t.value)).join(' ');
}

test('typing digits and an operator builds an expression in a fresh active block', () => {
  const h = harness();
  '12'.split('').forEach((d) => h.ctl.pressKey(d));
  h.ctl.pressKey('+');
  h.ctl.pressKey('3');
  assert.equal(h.canvas.blocks.length, 1);
  assert.equal(termSig(h.canvas.blocks[0]), 'number:12 operator:+ number:3');
  assert.equal(h.state.activeBlockId, h.canvas.blocks[0].id);
});

test('"=" finishes the block and drops an empty one', () => {
  const h = harness();
  h.ctl.pressKey('5');
  h.ctl.pressKey('=');
  assert.equal(h.state.activeBlockId, null);
  assert.equal(h.canvas.blocks.length, 1); // 5 kept

  h.ctl.pressKey('='); // nothing active -> no-op block creation
  assert.equal(h.canvas.blocks.length, 1);
});

test('"clear" and "del" route to the injected delete handlers', () => {
  const h = harness();
  h.ctl.pressKey('7');
  h.ctl.pressKey('clear');
  assert.equal(h.state.cleared, true);

  h.state.sel = { blockId: h.canvas.blocks[0].id, termIndex: 0, kind: 'number' };
  h.ctl.pressKey('del');
  assert.deepEqual(h.state.deletedRequests, [h.canvas.blocks[0].id]);
});

test('selecting an operator then pressing another replaces it in place', () => {
  const h = harness();
  ['8', '+', '5'].forEach((k) => h.ctl.pressKey(k));
  const b = h.canvas.blocks[0];
  h.state.sel = { blockId: b.id, termIndex: 1, kind: 'operator' };
  h.ctl.pressKey('*');
  assert.equal(termSig(b), 'number:8 operator:* number:5');
});

test('selecting a number after render then pressing "(" inserts before it', () => {
  const h = harness();
  ['2', '+', '4', '='].forEach((k) => h.ctl.pressKey(k));
  const b = h.canvas.blocks[0];
  h.state.sel = { blockId: b.id, termIndex: 0, kind: 'number' };
  h.state.activeBlockId = b.id;
  h.ctl.pressKey('(');
  assert.equal(termSig(b), 'paren:( number:2 operator:+ number:4');
  assert.deepEqual(h.state.sel, { blockId: null, termIndex: null, kind: null });
  assert.equal(h.state.activeBlockId, b.id);
});

test('opening "(" right after an operand inserts implicit multiplication', () => {
  const h = harness();
  ['0', '('].forEach((k) => h.ctl.pressKey(k));
  const b = h.canvas.blocks[0];
  assert.equal(termSig(b), 'number:0 operator:* paren:(');
  // and the expression stays well-formed (no missing-operator gap)
  assert.equal(Engine.missingOperatorIndex(b.terms), -1);
});

test('selecting the missing-operator gap then pressing an operator fills it', () => {
  const h = harness();
  // Build "0 ( 2 + 6 )" with a real gap by injecting terms (e.g. a legacy save).
  const b = h.canvas.blocks[0] = {
    id: 'b1', x: 0, y: 0, label: '',
    terms: [
      { type: 'number', value: '0', tid: 't1' },
      { type: 'paren', value: '(' },
      { type: 'number', value: '2', tid: 't2' },
      { type: 'operator', value: '+' },
      { type: 'number', value: '6', tid: 't3' },
      { type: 'paren', value: ')' }
    ]
  };
  const gap = Engine.missingOperatorIndex(b.terms);
  assert.equal(gap, 1);
  h.state.activeBlockId = b.id;
  h.state.sel = { blockId: b.id, termIndex: gap, kind: 'missing-op' };
  h.ctl.pressKey('*');
  assert.equal(termSig(b), 'number:0 operator:* paren:( number:2 operator:+ number:6 paren:)');
  assert.deepEqual(h.state.sel, { blockId: b.id, termIndex: 1, kind: 'operator' });
  assert.equal(Engine.missingOperatorIndex(b.terms), -1);
});

test('backspace deletes a selected parenthesis and selects the previous term', () => {
  const h = harness();
  ['(', '2', '+', '4', ')'].forEach((k) => h.ctl.pressKey(k));
  const b = h.canvas.blocks[0];
  h.state.sel = { blockId: b.id, termIndex: 4, kind: 'paren' };
  h.state.activeBlockId = b.id;
  h.ctl.pressKey('back');
  assert.equal(termSig(b), 'paren:( number:2 operator:+ number:4');
  assert.deepEqual(h.state.sel, { blockId: b.id, termIndex: 3, kind: 'number' });

  h.state.sel = { blockId: b.id, termIndex: 0, kind: 'paren' };
  h.ctl.pressKey('back');
  assert.equal(termSig(b), 'number:2 operator:+ number:4');
  assert.deepEqual(h.state.sel, { blockId: null, termIndex: null, kind: null });
});

test('result selected + operator spawns a linked block below', () => {
  const h = harness();
  ['4'].forEach((k) => h.ctl.pressKey(k));
  const src = h.canvas.blocks[0];
  h.state.sel = { blockId: src.id, termIndex: null, kind: 'result' };
  h.ctl.pressKey('+');
  assert.equal(h.canvas.blocks.length, 2);
  const linked = h.canvas.blocks[1];
  assert.equal(termSig(linked), 'linked:' + src.id + ' operator:+');
  assert.equal(h.state.activeBlockId, linked.id);
});

test('pasteText parses an expression into the active block', () => {
  const h = harness();
  assert.equal(h.ctl.pasteText('10 + 2 * 3'), true);
  assert.equal(h.canvas.blocks.length, 1);
  assert.equal(termSig(h.canvas.blocks[0]), 'number:10 operator:+ number:2 operator:* number:3');
  assert.ok(h.canvas.blocks[0].terms.every((t) => t.type !== 'number' || t.tid)); // tids assigned
  assert.equal(h.state.snaps, 1); // create + fill is one undoable action
});

test('pasteText reports invalid expressions without changing state', () => {
  const h = harness();
  assert.equal(h.ctl.pasteText('abc 5'), false);
  assert.equal(h.canvas.blocks.length, 0);
  assert.equal(h.state.snaps, 0);
});

test('pasteText inserts after a selected term, gluing instead of appending', () => {
  const h = harness();
  ['5', '+', '3'].forEach((k) => h.ctl.pressKey(k)); // 5 + 3
  const b = h.canvas.blocks[0];
  h.state.sel = { blockId: b.id, termIndex: 0, kind: 'number' }; // select the "5"
  assert.equal(h.ctl.pasteText('9'), true);
  assert.equal(termSig(b), 'number:5 operator:+ number:9 operator:+ number:3');
});

test('pasteText fills a missing-operator gap', () => {
  const h = harness();
  h.canvas.blocks.push({ id: 'bg', x: 0, y: 0, label: '', terms: [
    { type: 'number', value: '5', tid: 't-a' }, { type: 'number', value: '8', tid: 't-b' }
  ] });
  h.state.sel = { blockId: 'bg', termIndex: 1, kind: 'missing-op' };
  assert.equal(h.ctl.pasteText('9'), true);
  assert.equal(termSig(h.canvas.blocks.find((b) => b.id === 'bg')), 'number:5 operator:+ number:9 operator:+ number:8');
});

test('deleting a referenced number freezes its dependents to a constant', () => {
  const h = harness();
  // Source block with a number "7" that another block links to by term.
  ['7'].forEach((k) => h.ctl.pressKey(k));
  const src = h.canvas.blocks[0];
  const tid = src.terms[0].tid;
  h.canvas.blocks.push({ id: 'dep', x: 0, y: 0, label: '', terms: [
    { type: 'linked', sourceId: src.id, sourceTid: tid }, { type: 'operator', value: '+' },
    { type: 'number', value: '1', tid: 't-dep' }
  ] });
  // Select and backspace the "7" away (value already typed -> first back empties it).
  h.state.sel = { blockId: src.id, termIndex: 0, kind: 'number' };
  h.ctl.pressKey('back'); // "7" -> ""
  h.ctl.pressKey('back'); // "" -> removed; dependents freeze
  const dep = h.canvas.blocks.find((b) => b.id === 'dep');
  // The dangling link is frozen into a constant (its now-empty source reads 0),
  // so the dependent stays a valid expression instead of a broken "?" link.
  assert.equal(termSig(dep), 'number:0 operator:+ number:1');
  assert.equal(dep.terms.filter((t) => t.type === 'linked').length, 0);
});

test('keyboard link: pick up a result and place it into another block', () => {
  const h = harness();
  ['2', '+', '3'].forEach((k) => h.ctl.pressKey(k)); // block A = 2 + 3
  const a = h.canvas.blocks[0];
  h.ctl.pressKey('='); // finish; no active block
  // Make a second block B = 10
  ['1', '0'].forEach((k) => h.ctl.pressKey(k));
  const b = h.canvas.blocks[1];
  h.ctl.pressKey('='); // finish B

  // Pick up A's result, then target B's number and place the link after it.
  h.state.sel = { blockId: a.id, termIndex: null, kind: 'result' };
  h.ctl.pressKey('link');
  assert.match(h.state.linkStatus, /Linking 5/);
  h.state.sel = { blockId: b.id, termIndex: 0, kind: 'number' };
  h.ctl.pressKey('link');
  assert.equal(termSig(b), 'number:10 operator:+ linked:' + a.id);
  assert.equal(h.state.linkStatus, ''); // cleared after placing
});

test('keyboard link: a link that would create a cycle is refused', () => {
  const h = harness();
  ['8'].forEach((k) => h.ctl.pressKey(k)); // A = 8
  const a = h.canvas.blocks[0];
  h.ctl.pressKey('=');
  // B links A's result
  h.canvas.blocks.push({ id: 'B', x: 0, y: 0, label: '', terms: [{ type: 'linked', sourceId: a.id }] });
  const b = h.canvas.blocks.find((x) => x.id === 'B');
  // Pick up B's result, try to place into A -> A would depend on B depend on A.
  h.state.sel = { blockId: 'B', termIndex: null, kind: 'result' };
  h.ctl.pressKey('link');
  h.state.sel = { blockId: a.id, termIndex: 0, kind: 'number' };
  h.ctl.pressKey('link');
  assert.match(h.state.linkStatus, /loop/);
  assert.equal(termSig(a), 'number:8'); // unchanged
});

test('repeated ± on a result toggles the negation in place, no extra blocks', () => {
  const h = harness();
  ['2', '+', '3'].forEach((k) => h.ctl.pressKey(k));
  const a = h.canvas.blocks[0];
  h.ctl.pressKey('=');
  // First ± on A's result creates "-1 * linked(A)".
  h.state.sel = { blockId: a.id, termIndex: null, kind: 'result' };
  h.ctl.pressKey('neg');
  assert.equal(h.canvas.blocks.length, 2);
  const neg = h.canvas.blocks[1];
  assert.equal(termSig(neg), 'number:-1 operator:* linked:' + a.id);
  // ± on the negation block's result toggles its sign instead of stacking another.
  h.state.sel = { blockId: neg.id, termIndex: null, kind: 'result' };
  h.ctl.pressKey('neg');
  assert.equal(h.canvas.blocks.length, 2);
  assert.equal(termSig(neg), 'number:1 operator:* linked:' + a.id);
  h.ctl.pressKey('neg'); // and back again
  assert.equal(termSig(neg), 'number:-1 operator:* linked:' + a.id);
});

test('copy then paste rebuilds a live link in the same session', () => {
  const h = harness();
  ['1', '0'].forEach((k) => h.ctl.pressKey(k)); // A = 10
  const a = h.canvas.blocks[0];
  h.ctl.pressKey('=');
  // B = linked(A) + 1
  h.canvas.blocks.push({ id: 'B', x: 0, y: 0, label: '', terms: [
    { type: 'linked', sourceId: a.id }, { type: 'operator', value: '+' }, { type: 'number', value: '1', tid: 't-b' }
  ] });
  // Copy B (select its result) -> text is value-based, structure is kept internally.
  h.state.sel = { blockId: 'B', termIndex: null, kind: 'result' };
  const text = h.ctl.copySelection();
  assert.equal(text, '10 + 1');
  // Paste into a fresh block.
  h.state.sel = { blockId: null, termIndex: null, kind: null };
  h.state.activeBlockId = null;
  assert.equal(h.ctl.pasteText(text), true);
  const pasted = h.canvas.blocks[h.canvas.blocks.length - 1];
  assert.equal(termSig(pasted), 'linked:' + a.id + ' operator:+ number:1'); // link preserved
});

test('paste freezes a copied link whose source was deleted, to its copied value', () => {
  const h = harness();
  ['1', '0'].forEach((k) => h.ctl.pressKey(k)); // A = 10
  const a = h.canvas.blocks[0];
  h.ctl.pressKey('=');
  h.canvas.blocks.push({ id: 'B', x: 0, y: 0, label: '', terms: [{ type: 'linked', sourceId: a.id }] });
  h.state.sel = { blockId: 'B', termIndex: null, kind: 'result' };
  const text = h.ctl.copySelection(); // "10"
  // Source A disappears before pasting.
  h.canvas.blocks = h.canvas.blocks.filter((b) => b.id !== a.id);
  h.state.sel = { blockId: null, termIndex: null, kind: null };
  h.state.activeBlockId = null;
  assert.equal(h.ctl.pasteText(text), true);
  const pasted = h.canvas.blocks[h.canvas.blocks.length - 1];
  assert.equal(termSig(pasted), 'number:10'); // frozen to its copied value, no dangling link
});

test('external text that is not our copy still parses to plain numbers', () => {
  const h = harness();
  ['1', '0'].forEach((k) => h.ctl.pressKey(k));
  h.state.sel = { blockId: h.canvas.blocks[0].id, termIndex: 0, kind: 'number' };
  h.ctl.copySelection(); // internal clip text is "10"
  h.state.sel = { blockId: null, termIndex: null, kind: null };
  h.state.activeBlockId = null;
  assert.equal(h.ctl.pasteText('7 + 8'), true); // different text -> not internal
  const pasted = h.canvas.blocks[h.canvas.blocks.length - 1];
  assert.equal(termSig(pasted), 'number:7 operator:+ number:8');
});

test('currentSelectionText returns the selected number, else the active block expression', () => {
  const h = harness();
  ['9', '+', '1'].forEach((k) => h.ctl.pressKey(k));
  const b = h.canvas.blocks[0];
  h.state.sel = { blockId: b.id, termIndex: 0, kind: 'number' };
  assert.equal(h.ctl.currentSelectionText(), '9');
  h.state.sel = { blockId: null, termIndex: null, kind: null };
  assert.equal(h.ctl.currentSelectionText(), '9 + 1');
});

test('plus-minus starts a negative number in an empty block', () => {
  const h = harness();
  h.ctl.pressKey('neg');
  h.ctl.pressKey('5');
  assert.equal(h.canvas.blocks.length, 1);
  assert.equal(termSig(h.canvas.blocks[0]), 'number:-5');
  assert.deepEqual(h.state.sel, { blockId: h.canvas.blocks[0].id, termIndex: 0, kind: 'number' });
});

test('plus-minus after an operator prepares the next number as negative', () => {
  const h = harness();
  ['5', '+', 'neg', '8'].forEach((k) => h.ctl.pressKey(k));
  const b = h.canvas.blocks[0];
  assert.equal(termSig(b), 'number:5 operator:+ number:-8');
  assert.deepEqual(h.state.sel, { blockId: b.id, termIndex: 2, kind: 'number' });
});

test('plus-minus toggles a selected linked source number, not the active fallback', () => {
  const h = harness();
  const src = h.canvas.blocks[0] = {
    id: 'b1',
    x: 0,
    y: 0,
    label: '',
    terms: [
      { type: 'number', value: '58', tid: 't1' },
      { type: 'operator', value: '+' },
      { type: 'number', value: '76', tid: 't2' }
    ]
  };
  const dst = h.canvas.blocks[1] = {
    id: 'b2',
    x: 0,
    y: 0,
    label: '',
    terms: [
      { type: 'linked', sourceId: src.id, sourceTid: 't1' },
      { type: 'operator', value: '+' },
      { type: 'number', value: '2554', tid: 't3' }
    ]
  };
  h.state.activeBlockId = dst.id;
  h.state.sel = { blockId: dst.id, termIndex: 0, kind: 'linked' };
  h.ctl.pressKey('neg');
  assert.equal(src.terms[0].value, '-58');
  assert.equal(dst.terms[2].value, '2554');
});

test('plus-minus on a selected result creates a locally negated linked calculation', () => {
  const h = harness();
  ['2', '+', '3'].forEach((k) => h.ctl.pressKey(k));
  const src = h.canvas.blocks[0];
  h.state.sel = { blockId: src.id, termIndex: null, kind: 'result' };
  h.ctl.pressKey('neg');
  assert.equal(h.canvas.blocks.length, 2);
  const negated = h.canvas.blocks[1];
  assert.equal(termSig(negated), 'number:-1 operator:* linked:' + src.id);
  assert.equal(h.state.activeBlockId, negated.id);
  assert.deepEqual(h.state.sel, { blockId: null, termIndex: null, kind: null });
});

test('backspace clears a selected number, then deletes it, stepping left', () => {
  const h = harness();
  ['4', '2', '+', '7'].forEach((k) => h.ctl.pressKey(k));
  const b = h.canvas.blocks[0];
  h.state.sel = { blockId: b.id, termIndex: 0, kind: 'number' };
  h.ctl.pressKey('back'); // 42 -> 4
  assert.equal(b.terms[0].value, '4');
  h.ctl.pressKey('back'); // 4 -> ''  (still present, selected)
  assert.equal(b.terms[0].value, '');
});
