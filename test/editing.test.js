'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Editing = require('../editing.js');

let tid = 0;
function num(value) { return { type: 'number', value: String(value), tid: 't' + (++tid) }; }
function op(value) { return { type: 'operator', value }; }
function link(id) { return { type: 'linked', sourceId: id }; }
function block(terms) { return { id: 'b1', terms: terms.slice() }; }
function newNumber(value) { return num(value); }

test('insertOperatorAfterSelection freezes empty numbers and selects the inserted slot', () => {
  const b = block([num(5), op('+'), { type: 'number', value: '', tid: 't-empty' }, op('+'), num(2)]);
  const next = Editing.insertOperatorAfterSelection(b, 2, '-', newNumber);
  assert.deepEqual(b.terms.map((t) => t.type + ':' + (t.value ?? t.sourceId)), [
    'number:5', 'operator:+', 'number:0', 'operator:-', 'number:', 'operator:+', 'number:2'
  ]);
  assert.deepEqual(next, { blockId: 'b1', termIndex: 4, kind: 'number' });
});

test('replaceSelectedOperator changes only operator terms', () => {
  const b = block([num(8), op('+'), num(5)]);
  assert.equal(Editing.replaceSelectedOperator(b, 1, '*'), true);
  assert.equal(b.terms[1].value, '*');
  assert.equal(Editing.replaceSelectedOperator(b, 0, '-'), false);
  assert.equal(b.terms[0].value, '8');
});

test('insertParenNearSelection anchors parentheses around selected operands', () => {
  const b = block([num(2), op('+'), num(4)]);
  assert.equal(Editing.insertParenNearSelection(b, 0, '('), true);
  assert.deepEqual(b.terms.map((t) => t.type + ':' + t.value), ['paren:(', 'number:2', 'operator:+', 'number:4']);
  assert.equal(Editing.insertParenNearSelection(b, 3, ')'), true);
  assert.deepEqual(b.terms.map((t) => t.type + ':' + t.value), ['paren:(', 'number:2', 'operator:+', 'number:4', 'paren:)']);
  assert.equal(Editing.insertParenNearSelection(b, 2, '('), false);
});

test('backspaceSelectedTerm clears a number before deleting it and stepping left', () => {
  const b = block([num(7), op('+'), num(55)]);
  let next = Editing.backspaceSelectedTerm(b, 2);
  assert.equal(b.terms[2].value, '5');
  assert.deepEqual(next.selection, { blockId: 'b1', termIndex: 2, kind: 'number' });
  next = Editing.backspaceSelectedTerm(b, 2);
  assert.equal(b.terms[2].value, '');
  next = Editing.backspaceSelectedTerm(b, 2);
  assert.deepEqual(b.terms.map((t) => t.type + ':' + t.value), ['number:7', 'operator:+']);
  assert.deepEqual(next.selection, { blockId: 'b1', termIndex: 1, kind: 'operator' });
});

test('backspaceSelectedTerm removes linked terms and selects the previous term', () => {
  const b = block([num(12), op('+'), link('src')]);
  const next = Editing.backspaceSelectedTerm(b, 2);
  assert.deepEqual(b.terms.map((t) => t.type), ['number', 'operator']);
  assert.deepEqual(next.selection, { blockId: 'b1', termIndex: 1, kind: 'operator' });
});

test('backspaceSelectedTerm removes parentheses and selects previous terms accurately', () => {
  const b = block([{ type: 'paren', value: '(' }, num(12), { type: 'paren', value: ')' }]);
  let next = Editing.backspaceSelectedTerm(b, 2);
  assert.deepEqual(b.terms.map((t) => t.type + ':' + t.value), ['paren:(', 'number:12']);
  assert.deepEqual(next.selection, { blockId: 'b1', termIndex: 1, kind: 'number' });

  next = Editing.backspaceSelectedTerm(b, 1);
  assert.deepEqual(b.terms.map((t) => t.type + ':' + t.value), ['paren:(', 'number:1']);
  next = Editing.backspaceSelectedTerm(b, 1);
  assert.deepEqual(b.terms.map((t) => t.type + ':' + t.value), ['paren:(', 'number:']);
  next = Editing.backspaceSelectedTerm(b, 1);
  assert.deepEqual(b.terms.map((t) => t.type + ':' + t.value), ['paren:(']);
  assert.deepEqual(next.selection, { blockId: 'b1', termIndex: 0, kind: 'paren' });
});

test('deleteTermAndSelectPrev asks caller to remove empty blocks', () => {
  const b = block([num(1)]);
  const next = Editing.deleteTermAndSelectPrev(b, 0);
  assert.deepEqual(b.terms, []);
  assert.deepEqual(next, {
    removeBlockId: 'b1',
    selection: { blockId: null, termIndex: null, kind: null },
    activeBlockId: null
  });
});

test('active typing helpers handle operators, decimals, and backspace', () => {
  const b = block([]);
  Editing.appendDigitOrDot(b, '.', newNumber);
  Editing.appendDigitOrDot(b, '5', newNumber);
  Editing.appendOperator(b, '+', newNumber);
  Editing.appendOperator(b, '*', newNumber);
  Editing.appendDigitOrDot(b, '7', newNumber);
  assert.deepEqual(b.terms.map((t) => t.type + ':' + t.value), ['number:0.5', 'operator:*', 'number:7']);
  let result = Editing.backspaceActiveBlock(b);
  assert.equal(result.removeBlockId, null);
  assert.deepEqual(b.terms.map((t) => t.type + ':' + t.value), ['number:0.5', 'operator:*']);
});

test('toggleNumberSign handles empty starter and negative values', () => {
  const t = { type: 'number', value: '' };
  assert.equal(Editing.toggleNumberSign(t), true);
  assert.equal(t.value, '-');
  assert.equal(Editing.appendDigitValue(t.value, '5'), '-5');
  assert.equal(Editing.appendDigitValue(t.value, '.'), '-0.');
  assert.equal(Editing.toggleNumberSign(t), true);
  assert.equal(t.value, '');
  assert.equal(Editing.toggleNumberSign({ type: 'operator', value: '+' }), false);
});

test('startOrToggleNegativeInput creates or toggles the active number slot', () => {
  const empty = block([]);
  let next = Editing.startOrToggleNegativeInput(empty, newNumber);
  assert.deepEqual(empty.terms.map((t) => t.type + ':' + t.value), ['number:-']);
  assert.deepEqual(next, { blockId: 'b1', termIndex: 0, kind: 'number' });

  const afterOperator = block([num(5), op('+')]);
  next = Editing.startOrToggleNegativeInput(afterOperator, newNumber);
  assert.deepEqual(afterOperator.terms.map((t) => t.type + ':' + t.value), ['number:5', 'operator:+', 'number:-']);
  assert.deepEqual(next, { blockId: 'b1', termIndex: 2, kind: 'number' });

  next = Editing.startOrToggleNegativeInput(afterOperator, newNumber);
  assert.deepEqual(afterOperator.terms.map((t) => t.type + ':' + t.value), ['number:5', 'operator:+', 'number:']);
  assert.deepEqual(next, { blockId: 'b1', termIndex: 2, kind: 'number' });
});
