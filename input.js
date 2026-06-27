/* Canvas Calc - keypad/keyboard input controller and copy/paste text.
 * Translates key presses and pasted text into model mutations, delegating the
 * actual term edits to CanvasEditing. No direct DOM access: all view/storage
 * effects go through injected callbacks, which keeps pressKey unit-testable.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CanvasInput = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(deps) {
    var Editing = deps.Editing;
    var isOp = Editing.isOp;

    // ---------- Active block ----------
    function ensureActiveBlock() {
      var id = deps.getActiveBlockId();
      if (id) { var b = deps.byId(id); if (b) return b; }
      var pt = deps.nextSlot();
      var nb = deps.newBlock(deps.snap(pt.x), deps.snap(pt.y));
      deps.setActiveBlockId(nb.id);
      return nb;
    }

    // Apply the {removeBlockId, selection, activeBlockId} result of an edit helper.
    function applyEditSelection(result) {
      if (!result) return;
      if (result.removeBlockId) deps.removeBlock(result.removeBlockId);
      if (result.selection) deps.setSelection(result.selection);
      if (Object.prototype.hasOwnProperty.call(result, 'activeBlockId')) deps.setActiveBlockId(result.activeBlockId);
    }

    function linkedSourceNumber(term) {
      if (!term || term.type !== 'linked' || term.sourceTid == null) return null;
      var src = deps.byId(term.sourceId);
      if (!src) return null;
      for (var i = 0; i < src.terms.length; i++) {
        var candidate = src.terms[i];
        if (candidate.type === 'number' && candidate.tid === term.sourceTid) return candidate;
      }
      return null;
    }

    // Remove a term and move the selection to the previous one (backspace chain).
    function deleteTermAndSelectPrev(b, idx) {
      applyEditSelection(Editing.deleteTermAndSelectPrev(b, idx));
    }

    // ---------- Copy / paste ----------
    // Plain-text expression for a block (used when copying a result/block).
    function expressionText(b) {
      return b.terms.map(function (t) {
        if (t.type === 'operator') return t.value;
        if (t.type === 'paren') return t.value;
        if (t.type === 'number') return t.value === '' ? '0' : t.value;
        if (t.type === 'linked') { var lv = deps.linkedValue(t, deps.blocksMap()); return lv == null ? '0' : String(lv); }
        return '';
      }).join(' ');
    }

    // Text for the current selection (number/linked value, or a block's expression).
    function currentSelectionText() {
      var sel = deps.getSelection();
      if (sel.blockId != null && sel.termIndex != null && (sel.kind === 'number' || sel.kind === 'linked')) {
        var b = deps.byId(sel.blockId), t = b && b.terms[sel.termIndex]; if (!t) return null;
        if (t.type === 'number') return t.value === '' ? '0' : t.value;
        var lv = deps.linkedValue(t, deps.blocksMap()); return lv == null ? null : String(lv);
      }
      var activeBlockId = deps.getActiveBlockId();
      var rb = (sel.kind === 'result' && sel.blockId != null) ? deps.byId(sel.blockId)
             : (activeBlockId ? deps.byId(activeBlockId) : null);
      return rb && rb.terms.length ? expressionText(rb) : null;
    }

    // Insert parsed terms into the active block (or a new one).
    function pasteText(text) {
      var terms = deps.parseExpression(text);
      if (!terms.length) return;
      deps.commit(function () {
        var b = ensureActiveBlock();
        terms.forEach(function (t) {
          if (t.type === 'number' && t.tid == null) t.tid = 't' + (deps.cur().nextTid++); // engine returns tid-less numbers
          b.terms.push(t);
        });
        deps.setActiveBlockId(b.id); deps.clearSelection();
      });
    }

    // ---------- Key dispatch ----------
    function pressKey(k) {
      // Clear the whole canvas (with confirmation)
      if (k === 'clear') { deps.clearCanvas(); return; }

      // Delete the selected (or active) block
      if (k === 'del') {
        var dSel = deps.getSelection();
        var dActive = deps.getActiveBlockId();
        deps.confirmDeleteBlock(deps.byId(dSel.blockId) || (dActive ? deps.byId(dActive) : null));
        return;
      }

      // Finish the current block; next input starts a fresh one
      if (k === '=') {
        var eActive = deps.getActiveBlockId();
        var ab = eActive ? deps.byId(eActive) : null;
        if (ab && ab.terms.length === 0) { deps.snapshot(); deps.removeBlock(ab.id); deps.save(); }
        deps.setActiveBlockId(null); deps.clearSelection(); deps.renderAll();
        return;
      }

      // ± : toggle the selected number/link source, else the last number typed
      if (k === 'neg') {
        var nSel = deps.getSelection();
        var nt = null, nb_ = null, ni = -1;
        if (nSel.blockId != null && nSel.termIndex != null) {
          nb_ = deps.byId(nSel.blockId);
          ni = nSel.termIndex;
          if (nb_ && nb_.terms[ni]) {
            if (nSel.kind === 'number' && nb_.terms[ni].type === 'number') nt = nb_.terms[ni];
            else if (nSel.kind === 'linked') nt = linkedSourceNumber(nb_.terms[ni]);
          }
          if (!nt) return;
        } else {
          var nActive = deps.getActiveBlockId();
          if (nActive) {
            var ab2 = deps.byId(nActive);
            if (ab2) for (var z = ab2.terms.length - 1; z >= 0; z--) { if (ab2.terms[z].type === 'number') { nt = ab2.terms[z]; break; } }
          }
        }
        if (nt) {
          deps.commit(function () { Editing.toggleNumberSign(nt); });
        }
        return;
      }

      // Parentheses: append to the active block
      if (k === '(' || k === ')') {
        deps.commit(function () {
          var pb = ensureActiveBlock();
          Editing.appendParen(pb, k);
          deps.clearSelection(); deps.setActiveBlockId(pb.id);
        });
        return;
      }

      var sel = deps.getSelection();

      // Operator selected -> tap then press a new operator to change it
      if (sel.kind === 'operator' && sel.blockId && sel.termIndex !== null) {
        var obk = deps.byId(sel.blockId);
        var ot = obk && obk.terms[sel.termIndex];
        if (ot && ot.type === 'operator') {
          if (isOp(k)) { deps.commit(function () { Editing.replaceSelectedOperator(obk, sel.termIndex, k); }); return; }
          if (k === 'back') { deps.commit(function () { deleteTermAndSelectPrev(obk, sel.termIndex); }); return; }
          return; // ignore digits etc. while an operator is selected
        }
      }

      // Number/linked term selected + operator -> insert it (and a fresh slot) right after,
      // so you can build an expression in the middle (5 + [7] then "- 4" => 5 + 7 - 4 ...).
      if ((sel.kind === 'number' || sel.kind === 'linked') && sel.blockId && sel.termIndex !== null && isOp(k)) {
        var isb = deps.byId(sel.blockId);
        var ist = isb && isb.terms[sel.termIndex];
        if (ist) {
          deps.commit(function () {
            deps.setSelection(Editing.insertOperatorAfterSelection(isb, sel.termIndex, k, deps.newNumber));
            deps.setActiveBlockId(isb.id);
          });
          return;
        }
      }

      // Number/linked term selected -> edit digits, or backspace-chain (clear, then delete, stepping left)
      if (sel.blockId && sel.termIndex !== null && (k >= '0' && k <= '9' || k === '.' || k === 'back')) {
        var sb = deps.byId(sel.blockId); if (!sb) return;
        var term = sb.terms[sel.termIndex];
        if (term && term.type === 'number') {
          if (k === 'back') {
            deps.commit(function () { applyEditSelection(Editing.backspaceSelectedTerm(sb, sel.termIndex)); });
            return;
          }
          deps.commit(function () { term.value = Editing.appendDigitValue(term.value, k); });
          return;
        }
        if (term && term.type === 'linked' && k === 'back') {
          deps.commit(function () { applyEditSelection(Editing.backspaceSelectedTerm(sb, sel.termIndex)); }); // unlink & step left
          return;
        }
      }

      // Result selected + operator => create linked block below
      if (sel.kind === 'result' && sel.blockId && isOp(k)) {
        var srcB = deps.byId(sel.blockId); if (!srcB) return;
        deps.commit(function () {
          var nb = deps.newBlock(deps.snap(srcB.x), deps.snap(srcB.y + 70));
          nb.terms.push({ type: 'linked', sourceId: srcB.id });
          nb.terms.push({ type: 'operator', value: k });
          deps.setActiveBlockId(nb.id); deps.clearSelection();
        });
        return;
      }

      if (k === 'back') {
        var backActive = deps.getActiveBlockId();
        if (!backActive) return;
        deps.commit(function () {
          var backBlock = deps.byId(backActive);
          if (backBlock) applyEditSelection(Editing.backspaceActiveBlock(backBlock));
        });
        return;
      }

      if (isOp(k)) {
        deps.commit(function () { Editing.appendOperator(ensureActiveBlock(), k, deps.newNumber); });
        return;
      }

      // digit or dot
      deps.commit(function () { Editing.appendDigitOrDot(ensureActiveBlock(), k, deps.newNumber); });
    }

    return {
      pressKey: pressKey,
      pasteText: pasteText,
      expressionText: expressionText,
      currentSelectionText: currentSelectionText
    };
  }

  return { create: create };
});
