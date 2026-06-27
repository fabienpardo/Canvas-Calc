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
      // create just below the lowest block (same spot as the + button)
      var pt = deps.nextSlot();
      deps.snapshot();
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
      var b = ensureActiveBlock(); // snapshots if it creates a block
      deps.commit(function () {
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

      // ± : toggle the sign of the selected number, else the last number typed
      if (k === 'neg') {
        var nSel = deps.getSelection();
        var nb_ = null, ni = -1;
        if (nSel.kind === 'number' && nSel.blockId != null && nSel.termIndex != null) { nb_ = deps.byId(nSel.blockId); ni = nSel.termIndex; }
        else {
          var nActive = deps.getActiveBlockId();
          if (nActive) {
            var ab2 = deps.byId(nActive);
            if (ab2) for (var z = ab2.terms.length - 1; z >= 0; z--) { if (ab2.terms[z].type === 'number') { nb_ = ab2; ni = z; break; } }
          }
        }
        if (nb_ && ni >= 0 && nb_.terms[ni] && nb_.terms[ni].type === 'number') {
          deps.commit(function () { Editing.toggleNumberSign(nb_.terms[ni]); });
        }
        return;
      }

      // Parentheses: append to the active block
      if (k === '(' || k === ')') {
        var pb = ensureActiveBlock();
        deps.commit(function () {
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

      var b = ensureActiveBlock();

      if (k === 'back') {
        deps.commit(function () { applyEditSelection(Editing.backspaceActiveBlock(b)); });
        return;
      }

      if (isOp(k)) {
        deps.commit(function () { Editing.appendOperator(b, k, deps.newNumber); });
        return;
      }

      // digit or dot
      deps.commit(function () { Editing.appendDigitOrDot(b, k, deps.newNumber); });
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
