/* Canvas Calc - expression editing helpers.
 * Mutates block term arrays, but has no DOM/storage dependencies.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CanvasEditing = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isOp(k) {
    return k === '+' || k === '-' || k === '*' || k === '/';
  }

  function emptySelection() {
    return { blockId: null, termIndex: null, kind: null };
  }

  function selectionKind(term) {
    if (!term) return null;
    if (term.type === 'operator') return 'operator';
    if (term.type === 'linked') return 'linked';
    if (term.type === 'paren') return 'paren';
    return 'number';
  }

  function appendDigitValue(value, k) {
    value = value == null ? '' : String(value);
    if (value === '-' && k === '.') return '-0.';
    if (k === '.') return value.indexOf('.') < 0 ? value + (value === '' ? '0.' : '.') : value;
    return value + k;
  }

  function toggleNumberSign(term) {
    if (!term || term.type !== 'number') return false;
    var value = term.value == null ? '' : String(term.value);
    term.value = value.charAt(0) === '-' ? value.slice(1) : '-' + value;
    return true;
  }

  function startOrToggleNegativeInput(block, newNumber) {
    if (!block) return null;
    var terms = block.terms;
    var last = terms[terms.length - 1];
    if (last && last.type === 'number') {
      toggleNumberSign(last);
      return { blockId: block.id, termIndex: terms.length - 1, kind: 'number' };
    }
    terms.push(newNumber('-'));
    return { blockId: block.id, termIndex: terms.length - 1, kind: 'number' };
  }

  function deleteTermAndSelectPrev(block, idx) {
    block.terms.splice(idx, 1);
    if (block.terms.length === 0) {
      return { removeBlockId: block.id, selection: emptySelection(), activeBlockId: null };
    }
    var prev = idx - 1;
    if (prev >= 0) {
      return {
        removeBlockId: null,
        selection: { blockId: block.id, termIndex: prev, kind: selectionKind(block.terms[prev]) },
        activeBlockId: block.id
      };
    }
    return { removeBlockId: null, selection: emptySelection(), activeBlockId: block.id };
  }

  function replaceSelectedOperator(block, idx, k) {
    var term = block && block.terms[idx];
    if (!term || term.type !== 'operator' || !isOp(k)) return false;
    term.value = k;
    return true;
  }

  // Operator selected + a digit/dot: drop in a NEW operand immediately after the
  // selected operator ("5 [+] 3", type 8 -> "5 + 8 3"), landing right where you
  // tapped rather than merging into a neighbour. The gap with no operator before
  // the displaced operand is flagged by missingOperatorIndex (a "?" + marker
  // prompts you to fill it — see insertOperatorAfterSelection).
  function insertNumberAfterOperator(block, idx, k, newNumber) {
    var term = block && block.terms[idx];
    if (!term || term.type !== 'operator') return null;
    block.terms.splice(idx + 1, 0, newNumber(k === '.' ? '0.' : k));
    return { blockId: block.id, termIndex: idx + 1, kind: 'number' };
  }

  function insertOperatorAfterSelection(block, idx, k, newNumber) {
    var term = block && block.terms[idx];
    if (!term || !isOp(k)) return null;
    if (term.type === 'number' && term.value === '') term.value = '0';
    var next = block.terms[idx + 1];
    if (next && (next.type === 'number' || next.type === 'linked')) {
      // An operand already follows (e.g. the "3" in "5 + 8 3"): just drop the
      // operator into the gap so it binds the two — "5 + 8 + 3", no empty slot.
      block.terms.splice(idx + 1, 0, { type: 'operator', value: k });
      return { blockId: block.id, termIndex: idx + 1, kind: 'operator' };
    }
    block.terms.splice(idx + 1, 0, { type: 'operator', value: k }, newNumber(''));
    return { blockId: block.id, termIndex: idx + 2, kind: 'number' };
  }

  function backspaceSelectedTerm(block, idx) {
    var term = block && block.terms[idx];
    if (!term) return null;
    if (term.type === 'number') {
      if (term.value !== '') {
        term.value = term.value.slice(0, -1);
        return { removeBlockId: null, selection: { blockId: block.id, termIndex: idx, kind: 'number' }, activeBlockId: block.id };
      }
      return deleteTermAndSelectPrev(block, idx);
    }
    if (term.type === 'linked' || term.type === 'paren') return deleteTermAndSelectPrev(block, idx);
    return null;
  }

  // A completed operand directly before '(' means implicit multiplication
  // ("0(2+6)" === "0 * (2+6)"), so we materialise the '*' the way math does.
  function isCompletedOperand(term) {
    return !!term && (
      (term.type === 'number' && term.value !== '') ||
      term.type === 'linked' ||
      (term.type === 'paren' && term.value === ')')
    );
  }

  function appendParen(block, k) {
    var terms = block.terms;
    if (k === '(' && isCompletedOperand(terms[terms.length - 1])) {
      terms.push({ type: 'operator', value: '*' });
    }
    terms.push({ type: 'paren', value: k });
  }

  // How many '(' in the block never get a matching ')'. Pure — no mutation.
  function unmatchedOpenParens(block) {
    var terms = block && block.terms;
    var depth = 0;
    if (terms) for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      if (t.type !== 'paren') continue;
      if (t.value === '(') depth++;
      else if (t.value === ')' && depth > 0) depth--;
    }
    return depth;
  }

  // Append the ')' needed to close any still-open groups. Used when a block is
  // committed (e.g. '=') so the on-screen expression matches what the tolerant
  // evaluator already computes. Returns how many closers were added.
  function balanceParens(block) {
    var depth = unmatchedOpenParens(block);
    for (var j = 0; j < depth; j++) block.terms.push({ type: 'paren', value: ')' });
    return depth;
  }

  function insertParenNearSelection(block, idx, k) {
    var term = block && block.terms[idx];
    if (!term || (term.type !== 'number' && term.type !== 'linked') || (k !== '(' && k !== ')')) return false;
    var at = k === '(' ? idx : idx + 1;
    // Implicit multiplication when a '(' lands right after another operand.
    if (k === '(' && isCompletedOperand(block.terms[at - 1])) {
      block.terms.splice(at, 0, { type: 'operator', value: '*' });
      at += 1;
    }
    block.terms.splice(at, 0, { type: 'paren', value: k });
    return true;
  }

  // Fill the gap flagged by missingOperatorIndex: drop an operator immediately
  // before the operand (or '(') at idx, binding it to the operand on its left.
  function insertOperatorAtGap(block, idx, k) {
    if (!block || !isOp(k) || idx < 0 || idx > block.terms.length) return null;
    block.terms.splice(idx, 0, { type: 'operator', value: k });
    return { blockId: block.id, termIndex: idx, kind: 'operator' };
  }

  // A term that a following value would collide with (its right edge is a value).
  function endsWithValue(t) {
    return !!t && (t.type === 'number' || t.type === 'linked' || (t.type === 'paren' && t.value === ')'));
  }
  // A term that a preceding value would collide with (its left edge is a value).
  function startsWithValue(t) {
    return !!t && (t.type === 'number' || t.type === 'linked' || (t.type === 'paren' && t.value === '('));
  }

  // Splice a run of terms (e.g. a pasted sub-expression) into a block at idx,
  // gluing with '+' wherever the insertion would leave two values touching.
  // idx === block.terms.length appends. Never overwrites; mirrors the drag-drop
  // insertion rule so paste and drag behave the same. Returns the index just
  // past the inserted run.
  function insertTermsAt(block, idx, terms) {
    if (!block || !terms || !terms.length) return idx;
    var seq = terms.slice();
    var before = block.terms[idx - 1];
    var at = block.terms[idx];
    if (endsWithValue(seq[seq.length - 1]) && startsWithValue(at)) seq.push({ type: 'operator', value: '+' });
    if (endsWithValue(before) && startsWithValue(seq[0])) seq.unshift({ type: 'operator', value: '+' });
    Array.prototype.splice.apply(block.terms, [idx, 0].concat(seq));
    return idx + seq.length;
  }

  // A block created by ± on a result: exactly "(-1|1) * <linked>". Recognising
  // it lets a repeated ± toggle that sign in place instead of stacking another
  // negated block on top.
  function isNegationBlock(block) {
    var t = block && block.terms;
    return !!t && t.length === 3 &&
      t[0].type === 'number' && (t[0].value === '-1' || t[0].value === '1') &&
      t[1].type === 'operator' && t[1].value === '*' &&
      t[2].type === 'linked';
  }

  function backspaceActiveBlock(block) {
    var terms = block.terms;
    var last = terms[terms.length - 1];
    if (!last) return { removeBlockId: block.id };
    if (last.type === 'number') {
      last.value = last.value.slice(0, -1);
      if (last.value === '') terms.pop();
    } else {
      terms.pop();
    }
    return { removeBlockId: null };
  }

  function appendOperator(block, k, newNumber) {
    var terms = block.terms;
    var last = terms[terms.length - 1];
    if (!last) {
      terms.push(newNumber('0'));
    } else if (last.type === 'operator') {
      last.value = k;
      return { replaced: true };
    } else if (last.type === 'number' && last.value === '') {
      last.value = '0';
    }
    terms.push({ type: 'operator', value: k });
    return { replaced: false };
  }

  function appendDigitOrDot(block, k, newNumber) {
    var terms = block.terms;
    var last = terms[terms.length - 1];
    if (!last || last.type === 'operator' || last.type === 'linked' || last.type === 'paren') {
      terms.push(newNumber(k === '.' ? '0.' : k));
    } else if (last.type === 'number') {
      last.value = appendDigitValue(last.value, k);
    }
  }

  return {
    isOp: isOp,
    emptySelection: emptySelection,
    selectionKind: selectionKind,
    appendDigitValue: appendDigitValue,
    toggleNumberSign: toggleNumberSign,
    startOrToggleNegativeInput: startOrToggleNegativeInput,
    deleteTermAndSelectPrev: deleteTermAndSelectPrev,
    replaceSelectedOperator: replaceSelectedOperator,
    insertNumberAfterOperator: insertNumberAfterOperator,
    insertOperatorAfterSelection: insertOperatorAfterSelection,
    backspaceSelectedTerm: backspaceSelectedTerm,
    appendParen: appendParen,
    unmatchedOpenParens: unmatchedOpenParens,
    balanceParens: balanceParens,
    insertParenNearSelection: insertParenNearSelection,
    insertOperatorAtGap: insertOperatorAtGap,
    insertTermsAt: insertTermsAt,
    isNegationBlock: isNegationBlock,
    backspaceActiveBlock: backspaceActiveBlock,
    appendOperator: appendOperator,
    appendDigitOrDot: appendDigitOrDot
  };
});
