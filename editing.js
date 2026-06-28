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
    return 'number';
  }

  function appendDigitValue(value, k) {
    value = value == null ? '' : String(value);
    if (k === '.') return value.indexOf('.') < 0 ? value + (value === '' ? '0.' : '.') : value;
    return value + k;
  }

  function toggleNumberSign(term) {
    if (!term || term.type !== 'number') return false;
    var value = term.value == null ? '' : String(term.value);
    term.value = value.charAt(0) === '-' ? value.slice(1) : '-' + (value === '' ? '0' : value);
    return true;
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
    if (term.type === 'linked') return deleteTermAndSelectPrev(block, idx);
    return null;
  }

  function appendParen(block, k) {
    block.terms.push({ type: 'paren', value: k });
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
    deleteTermAndSelectPrev: deleteTermAndSelectPrev,
    replaceSelectedOperator: replaceSelectedOperator,
    insertNumberAfterOperator: insertNumberAfterOperator,
    insertOperatorAfterSelection: insertOperatorAfterSelection,
    backspaceSelectedTerm: backspaceSelectedTerm,
    appendParen: appendParen,
    backspaceActiveBlock: backspaceActiveBlock,
    appendOperator: appendOperator,
    appendDigitOrDot: appendDigitOrDot
  };
});
