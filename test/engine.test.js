'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');

// ---------- builders ----------
let _tid = 0;
function num(value, label) { return { type: 'number', value: String(value), tid: 't' + (++_tid), label: label || '' }; }
function op(v) { return { type: 'operator', value: v }; }
function par(v) { return { type: 'paren', value: v }; }
function linkResult(srcId) { return { type: 'linked', sourceId: srcId }; }
function linkTerm(srcId, tid) { return { type: 'linked', sourceId: srcId, sourceTid: tid }; }
function block(id, terms, label) { return { id: id, x: 0, y: 0, label: label || '', terms: terms }; }
function mapOf() { var m = {}; for (var i = 0; i < arguments.length; i++) m[arguments[i].id] = arguments[i]; return m; }
function evalExpr(terms) { var b = block('b', terms); return E.resolve(b, mapOf(b)); }

// ---------- evaluation ----------
test('precedence: + after * ', () => {
  assert.equal(evalExpr([num(2), op('+'), num(3), op('*'), num(4)]), 14);
  assert.equal(evalExpr([num(2), op('*'), num(3), op('+'), num(4), op('*'), num(5)]), 26);
});

test('parentheses override precedence', () => {
  assert.equal(evalExpr([par('('), num(2), op('+'), num(3), par(')'), op('*'), num(4)]), 20);
});

test('nested parentheses', () => {
  // 2 * (3 + (4 - 1)) = 12
  assert.equal(evalExpr([num(2), op('*'), par('('), num(3), op('+'), par('('), num(4), op('-'), num(1), par(')'), par(')')]), 12);
});

test('division is left-associative', () => {
  assert.equal(evalExpr([num(10), op('/'), num(2), op('/'), num(5)]), 1);
});

test('negative number value', () => {
  assert.equal(evalExpr([num(5), op('+'), num('-8')]), -3);
});

test('tolerant: trailing operator ignored', () => {
  assert.equal(evalExpr([num(5), op('+')]), 5);
});

test('tolerant: empty parens evaluate to 0', () => {
  assert.equal(evalExpr([num(2), op('*'), par('('), par(')')]), 0);
});

test('empty expression is null', () => {
  assert.equal(evalExpr([]), null);
});

test('division by zero yields Infinity / NaN that fmt renders', () => {
  assert.equal(evalExpr([num(1), op('/'), num(0)]), Infinity);
  assert.equal(E.fmt(evalExpr([num(1), op('/'), num(0)])), '∞');
  assert.ok(Number.isNaN(evalExpr([num(0), op('/'), num(0)])));
  assert.equal(E.fmt(evalExpr([num(0), op('/'), num(0)])), '—');
});

// ---------- linked values ----------
test('linked result cascades and updates live', () => {
  var a = block('a', [num(10)]);
  var b = block('b', [linkResult('a'), op('*'), num(2)]);
  var m = mapOf(a, b);
  assert.equal(E.resolve(b, m), 20);
  a.terms[0].value = '20';
  assert.equal(E.resolve(b, m), 40);
});

test('linked number-term resolves to that term value', () => {
  var price = num(12); // a labeled input inside a block
  var a = block('a', [price, op('*'), num(3)]);
  var b = block('b', [linkTerm('a', price.tid), op('+'), num(1)]);
  var m = mapOf(a, b);
  assert.equal(E.resolve(b, m), 13); // 12 + 1
});

test('a cycle inside a linked operand degrades to 0 instead of hanging', () => {
  var a = block('a', [linkResult('b')]);
  var b = block('b', [linkResult('a')]);
  var m = mapOf(a, b);
  assert.equal(E.resolve(a, m), 0); // self-detected cycle -> null -> coerced to 0; must not infinite-loop
});

test('linkedValue returns null when the source is missing', () => {
  assert.equal(E.linkedValue({ type: 'linked', sourceId: 'gone' }, {}), null);
});

test('blockDefinition shows ? for a missing linked source', () => {
  var b = block('b', [linkResult('gone')]);
  assert.equal(E.blockDefinition(b, mapOf(b)), '?');
});

// ---------- cycle detection ----------
test('createsCycle: direct and indirect are refused', () => {
  // b already depends on a's result; linking a -> b would close the loop
  var a = block('a', [num(1)]);
  var b = block('b', [linkResult('a')]);
  assert.equal(E.createsCycle('a', 'b', mapOf(a, b)), true);
  assert.equal(E.createsCycle('a', 'x', mapOf(a, b)), false); // unrelated
  assert.equal(E.createsCycle('a', 'a', mapOf(a, b)), true);  // self
});

test('createsCycle detects indirect (transitive) cycles', () => {
  var a = block('a', [num(1)]);
  var b = block('b', [linkResult('a')]); // b depends on a
  var c = block('c', [linkResult('b')]); // c depends on b
  // linking a -> c would close the loop a -> c -> b -> a
  assert.equal(E.createsCycle('a', 'c', mapOf(a, b, c)), true);
});

test('createsCycle: number-term links are constants, never a cycle', () => {
  var t = num(5);
  var a = block('a', [t]);
  var b = block('b', [linkTerm('a', t.tid)]); // b references a NUMBER in a, not a's result
  assert.equal(E.createsCycle('a', 'b', mapOf(a, b)), false);
});

// ---------- formatting ----------
test('fmt: specials and grouping', () => {
  assert.equal(E.fmt(null), '');
  assert.equal(E.fmt(NaN), '—');
  assert.equal(E.fmt(Infinity), '∞');
  assert.equal(E.fmt(-Infinity), '-∞');
  assert.equal(E.fmt(5), '5');
  var G = E.NUM_GROUP;
  assert.equal(E.fmt(1234567), '1' + G + '234' + G + '567');
});

test('groupDisplay: in-progress typing preserves decimal tail', () => {
  assert.equal(E.groupDisplay('1234', ',', '.'), '1,234');
  assert.equal(E.groupDisplay('1234.', ',', '.'), '1,234.');
  assert.equal(E.groupDisplay('1234.50', ',', '.'), '1,234.50');
  assert.equal(E.groupDisplay('-1234', ',', '.'), '-1,234');
  assert.equal(E.groupDisplay('', ',', '.'), '0');
  assert.equal(E.groupDisplay(1234, ',', '.'), '1,234');
});

// ---------- clipboard parsing ----------
test('parseExpression: separators, parens, evaluates correctly', () => {
  assert.equal(evalExpr(E.parseExpression('1,234 + 5*(2)', ',', '.')), 1244);
});

test('parseExpression: normalizes × ÷ − glyphs', () => {
  assert.equal(evalExpr(E.parseExpression('2 × 3 ÷ 6', ',', '.')), 1);
});

test('parseExpression: sign minus vs operator minus', () => {
  assert.equal(evalExpr(E.parseExpression('10 - 3', ',', '.')), 7);
  assert.equal(evalExpr(E.parseExpression('-5 + 2', ',', '.')), -3);
  assert.equal(evalExpr(E.parseExpression('(-5)', ',', '.')), -5);
  assert.equal(evalExpr(E.parseExpression('-(2 + 3)', ',', '.')), -5);
});

test('parseExpression: unary minus before parens keeps grouping after * and /', () => {
  assert.equal(evalExpr(E.parseExpression('10 / -(2 + 3)', ',', '.')), -2);
  assert.equal(evalExpr(E.parseExpression('6 * -(1 + 2)', ',', '.')), -18);
  assert.equal(evalExpr(E.parseExpression('12 / -(2) / -(3)', ',', '.')), 2);
  assert.equal(evalExpr(E.parseExpression('-(4 + -(1 + 1))', ',', '.')), -2);
});

test('isComplete: a block shows a result only past a bare value / mid-entry', () => {
  assert.equal(E.isComplete([]), false);
  assert.equal(E.isComplete([num(5)]), false);              // lone literal number
  assert.equal(E.isComplete([num(5), op('+')]), false);     // trailing operator
  assert.equal(E.isComplete([num(5), op('+'), num(5)]), true);
  assert.equal(E.isComplete([num(5), op('+'), par('(')]), false); // open paren tail
  assert.equal(E.isComplete([linkResult('a')]), true);      // lone alias keeps its result
});

test('parseExpression: rejects unsupported or malformed pasted text', () => {
  assert.deepEqual(E.parseExpression('abc 5', ',', '.'), []);
  assert.deepEqual(E.parseExpression('2(3+4)', ',', '.'), []);
  assert.deepEqual(E.parseExpression('1e3 + 2', ',', '.'), []);
  assert.deepEqual(E.parseExpression('1..2 + 3', ',', '.'), []);
  assert.deepEqual(E.parseExpression('5 +', ',', '.'), []);
  assert.deepEqual(E.parseExpression('', ',', '.'), []);
});

test('parseExpression: number terms come back without a tid', () => {
  var terms = E.parseExpression('5 + 6', ',', '.');
  var nums = terms.filter(function (t) { return t.type === 'number'; });
  assert.ok(nums.every(function (t) { return t.tid === undefined; }));
});

// ---------- definition (labels) ----------
test('blockDefinition expresses the formula in labels', () => {
  var a = block('a', [num(10)], 'A');
  var b = block('b', [num(4)], 'B');
  var total = block('t', [linkResult('a'), op('+'), linkResult('b'), op('*'), num(3, 'C')]);
  assert.equal(E.blockDefinition(total, mapOf(a, b, total)), 'A + B × C');
});
