/* Canvas Calc — pure calculation/formatting/parsing engine.
 * No DOM, no app state: every function is deterministic given its arguments.
 * Loaded by index.html via <script>, and unit-tested directly under node:test.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CanvasEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Locale-aware separators ----------
  var NUM_GROUP = ',', NUM_DECIMAL = '.';
  try {
    new Intl.NumberFormat().formatToParts(11111.1).forEach(function (p) {
      if (p.type === 'group') NUM_GROUP = p.value;
      if (p.type === 'decimal') NUM_DECIMAL = p.value;
    });
  } catch (e) {}
  var GROUPED_FMT = (function () {
    try { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 10 }); } catch (e) { return null; }
  })();

  // ---------- Model helpers ----------
  function findTermByTid(b, tid) {
    for (var i = 0; i < b.terms.length; i++) { var t = b.terms[i]; if (t.type === 'number' && t.tid === tid) return t; }
    return null;
  }

  // Value of a linked term: a referenced number term, or a block's result.
  function linkedValue(t, map) {
    var src = map[t.sourceId]; if (!src) return null;
    if (t.sourceTid != null) {
      var term = findTermByTid(src, t.sourceTid); if (!term) return null;
      var v = parseFloat(term.value); return isNaN(v) ? 0 : v;
    }
    return resolve(src, map);
  }
  // Label accessor for a linked term's source (number term or block title).
  function linkedSource(t, map) {
    var src = map[t.sourceId]; if (!src) return null;
    if (t.sourceTid != null) {
      var term = findTermByTid(src, t.sourceTid); if (!term) return null;
      return { getLabel: function () { return term.label; }, setLabel: function (v) { term.label = v; } };
    }
    return { getLabel: function () { return src.label; }, setLabel: function (v) { src.label = v; } };
  }

  // ---------- Evaluation ----------
  // Build a token stream from a block's terms, resolving linked operands to numbers.
  function tokenize(block, map, stack) {
    var tokens = [];
    block.terms.forEach(function (t) {
      if (t.type === 'operator') tokens.push({ op: t.value });
      else if (t.type === 'paren') tokens.push({ paren: t.value });
      else if (t.type === 'number') { var v = parseFloat(t.value); tokens.push({ num: isNaN(v) ? 0 : v }); }
      else if (t.type === 'linked') {
        var src = map[t.sourceId], val = 0;
        if (src) {
          if (t.sourceTid != null) {
            var lt = findTermByTid(src, t.sourceTid);
            var lv = lt ? parseFloat(lt.value) : NaN; val = isNaN(lv) ? 0 : lv;
          } else {
            var sub = {}; for (var k in stack) sub[k] = stack[k];
            var r = resolve(src, map, sub); val = (r == null || isNaN(r)) ? 0 : r;
          }
        }
        tokens.push({ num: val });
      }
    });
    return tokens;
  }

  // Tolerant recursive-descent evaluator: + - * / and parentheses.
  // Trailing operators, empty parens, and stray tokens are skipped gracefully.
  function evalTokens(tokens) {
    var pos = 0;
    function peek() { return tokens[pos]; }
    function parseExpr() {
      var v = parseTerm();
      while (peek() && (peek().op === '+' || peek().op === '-')) {
        var op = tokens[pos++].op, rhs = parseTerm();
        if (rhs == null) break;
        v = (v == null ? 0 : v) + (op === '+' ? rhs : -rhs);
      }
      return v;
    }
    function parseTerm() {
      var v = parseFactor();
      while (peek() && (peek().op === '*' || peek().op === '/')) {
        var op = tokens[pos++].op, rhs = parseFactor();
        if (rhs == null) break;
        v = op === '*' ? (v == null ? 0 : v) * rhs : (v == null ? 0 : v) / rhs;
      }
      return v;
    }
    function parseFactor() {
      var t = peek();
      if (!t) return null;
      if (t.paren === '(') {
        pos++;
        var v = parseExpr();
        if (peek() && peek().paren === ')') pos++;
        return v == null ? 0 : v;
      }
      if (t.num !== undefined) { pos++; return t.num; }
      pos++; // stray operator or ')' -> skip and continue
      return parseFactor();
    }
    if (!tokens.length) return null;
    return parseExpr();
  }

  function resolve(block, map, stack) {
    stack = stack || {};
    if (stack[block.id]) return null; // cycle
    stack[block.id] = true;
    var tokens = tokenize(block, map, stack);
    delete stack[block.id];
    return evalTokens(tokens);
  }

  // Would target depend (directly/indirectly) on itself if it links newSource?
  // Number-term links are constants, so they never form a cycle.
  function createsCycle(targetBlockId, newSourceId, map) {
    if (targetBlockId === newSourceId) return true;
    function deps(id, seen) {
      if (seen[id]) return false; seen[id] = true;
      var b = map[id]; if (!b) return false;
      for (var i = 0; i < b.terms.length; i++) {
        var t = b.terms[i];
        if (t.type === 'linked' && t.sourceTid == null) {
          if (t.sourceId === targetBlockId) return true;
          if (deps(t.sourceId, seen)) return true;
        }
      }
      return false;
    }
    return deps(newSourceId, {});
  }

  // ---------- Formatting ----------
  function fmt(v) {
    if (v === null || v === undefined) return '';
    if (Number.isNaN(v)) return '—';
    if (!isFinite(v)) return '∞';
    var r = Math.round(v * 1e10) / 1e10;
    if (GROUPED_FMT) return GROUPED_FMT.format(r);
    if (Number.isInteger(r)) return String(r);
    return String(parseFloat(r.toFixed(8)));
  }

  // Group an in-progress raw number string ("1234.5" -> "1,234.5"), preserving a trailing dot.
  function groupDisplay(raw, group, decimal) {
    group = group == null ? NUM_GROUP : group;
    decimal = decimal == null ? NUM_DECIMAL : decimal;
    if (raw === '' || raw == null) return '0';
    var neg = raw.charAt(0) === '-';
    var s = neg ? raw.slice(1) : raw;
    var dot = s.indexOf('.');
    var intPart = dot < 0 ? s : s.slice(0, dot);
    var rest = dot < 0 ? '' : s.slice(dot + 1);
    var grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, group);
    var out = grouped + (dot < 0 ? '' : decimal + rest);
    return (neg ? '-' : '') + out;
  }

  // ---------- Definition / symbols ----------
  function opSym(v) { return ({ '+': '+', '-': '−', '*': '×', '/': '÷' })[v]; }
  function labelOf(s) { return (s && s.trim()) ? s.trim() : ''; }

  // Express a block's formula using the labels of its operands.
  function blockDefinition(b, map) {
    if (!b.terms.length) return '—';
    var parts = [];
    b.terms.forEach(function (t) {
      if (t.type === 'operator') parts.push(opSym(t.value));
      else if (t.type === 'paren') parts.push(t.value);
      else if (t.type === 'number') parts.push(labelOf(t.label) || (t.value === '' ? '0' : t.value));
      else if (t.type === 'linked') {
        var src = map[t.sourceId];
        if (!src) { parts.push('?'); }
        else if (t.sourceTid != null) {
          var term = findTermByTid(src, t.sourceTid);
          parts.push(term ? (labelOf(term.label) || (term.value === '' ? '0' : term.value)) : '?');
        } else {
          parts.push(labelOf(src.label) || fmt(resolve(src, map)));
        }
      }
    });
    return parts.join(' ');
  }

  // ---------- Clipboard parsing ----------
  // Parse text into terms (numbers, operators, parens); strips separators.
  // Number terms come back WITHOUT a tid — the caller assigns one when inserting.
  function parseExpression(text, group, decimal) {
    group = group == null ? NUM_GROUP : group;
    decimal = decimal == null ? NUM_DECIMAL : decimal;
    if (text == null) return [];
    var s = String(text);
    s = s.split(group).join('');
    if (decimal !== '.') s = s.split(decimal).join('.');
    s = s.replace(/[×✕]/g, '*').replace(/[÷]/g, '/').replace(/[−–—]/g, '-').replace(/,/g, '');
    var terms = [], i = 0;
    while (i < s.length) {
      var c = s.charAt(i);
      if (/\s/.test(c)) { i++; continue; }
      if (c === '(' || c === ')') { terms.push({ type: 'paren', value: c }); i++; continue; }
      if (c === '+' || c === '*' || c === '/') { terms.push({ type: 'operator', value: c }); i++; continue; }
      if (c === '-') {
        var prev = terms[terms.length - 1];
        var isSign = !prev || prev.type === 'operator' || (prev.type === 'paren' && prev.value === '(');
        if (isSign) {
          var j = i + 1, num = '-';
          while (j < s.length && /[0-9.]/.test(s.charAt(j))) { num += s.charAt(j); j++; }
          if (num === '-') { terms.push({ type: 'operator', value: '-' }); i++; }
          else { terms.push({ type: 'number', value: num }); i = j; }
        } else { terms.push({ type: 'operator', value: '-' }); i++; }
        continue;
      }
      if (/[0-9.]/.test(c)) {
        var k2 = i, n = '';
        while (k2 < s.length && /[0-9.]/.test(s.charAt(k2))) { n += s.charAt(k2); k2++; }
        terms.push({ type: 'number', value: n }); i = k2; continue;
      }
      i++; // skip anything else
    }
    return terms;
  }

  return {
    NUM_GROUP: NUM_GROUP, NUM_DECIMAL: NUM_DECIMAL,
    findTermByTid: findTermByTid,
    linkedValue: linkedValue, linkedSource: linkedSource,
    tokenize: tokenize, evalTokens: evalTokens, resolve: resolve,
    createsCycle: createsCycle,
    fmt: fmt, groupDisplay: groupDisplay,
    opSym: opSym, labelOf: labelOf, blockDefinition: blockDefinition,
    parseExpression: parseExpression
  };
});
