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
    var pendingLink = null; // keyboard link flow: the picked-up source, awaiting a target

    function status(msg) { if (deps.setLinkStatus) deps.setLinkStatus(msg); }

    // Freeze a number term's dependents into constants just before it's deleted,
    // so other blocks that linked to it keep a valid value instead of a "?".
    function freezeIfReferencedNumber(block, term) {
      if (!deps.freezeTermDependents) return;
      if (term && term.type === 'number' && term.tid != null) {
        deps.freezeTermDependents(block.id, term.tid, term.value);
      }
    }

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

    // ---------- Keyboard linking ----------
    // A pointer-free equivalent of drag-to-link: select a result/number and press
    // L to pick it up, select a target slot and press L again to place it.
    function linkValueText(sourceId, sourceTid) {
      var lv = deps.linkedValue({ type: 'linked', sourceId: sourceId, sourceTid: sourceTid }, deps.blocksMap());
      return lv == null ? 'value' : String(lv);
    }
    function linkSourceFromSelection(sel) {
      if (sel.blockId == null) return null;
      if (sel.kind === 'result') return { sourceId: sel.blockId, sourceTid: null };
      if (sel.termIndex == null) return null;
      var b = deps.byId(sel.blockId), t = b && b.terms[sel.termIndex];
      if (!t) return null;
      if (sel.kind === 'number' && t.type === 'number') return { sourceId: sel.blockId, sourceTid: t.tid };
      if (sel.kind === 'linked' && t.type === 'linked') return { sourceId: t.sourceId, sourceTid: t.sourceTid }; // chain
      return null;
    }
    function placePendingLink(sel) {
      var src = pendingLink;
      var target = sel.blockId != null ? deps.byId(sel.blockId) : null;
      if (!target) { status('Select a target slot, then press L to place the link.'); return; }
      var idx;
      if (sel.kind === 'missing-op') idx = sel.termIndex;     // fill the gap
      else if (sel.termIndex != null) idx = sel.termIndex + 1; // just after the selected term
      else idx = target.terms.length;                         // result selected / no term: append
      if (src.sourceTid == null && deps.createsCycle && deps.createsCycle(target.id, src.sourceId)) {
        pendingLink = null;
        status('Can’t link — it would create a loop where a result depends on itself.');
        return;
      }
      deps.commit(function () {
        Editing.insertTermsAt(target, idx, [{ type: 'linked', sourceId: src.sourceId, sourceTid: src.sourceTid }]);
        deps.setActiveBlockId(target.id); deps.clearSelection();
      });
      pendingLink = null;
      status('');
    }
    function handleLinkKey() {
      var sel = deps.getSelection();
      if (!pendingLink) {
        var src = linkSourceFromSelection(sel);
        if (!src) { status('Select a result or number, then press L to start a link.'); return; }
        pendingLink = src;
        status('Linking ' + linkValueText(src.sourceId, src.sourceTid) +
          '. Select a target slot, then press L to place it. Escape cancels.');
        return;
      }
      placePendingLink(sel);
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

    // Insert parsed terms at the current selection/gap, or append to the active
    // block (or a new one) when nothing is selected. Insertion glues with '+' so
    // it never overwrites a term — the same rule as a drag-drop insert.
    function pasteText(text) {
      var terms = deps.parseExpression(text);
      if (!terms.length) return false;
      deps.commit(function () {
        var sel = deps.getSelection();
        var target = null, idx = null;
        if (sel.blockId != null && sel.termIndex != null) {
          target = deps.byId(sel.blockId);
          if (target) {
            // Land in a missing-operator gap; otherwise just after the selection.
            idx = sel.kind === 'missing-op' ? sel.termIndex : sel.termIndex + 1;
          }
        }
        if (!target) { target = ensureActiveBlock(); idx = target.terms.length; }
        terms.forEach(function (t) {
          if (t.type === 'number' && t.tid == null) t.tid = 't' + (deps.cur().nextTid++); // engine returns tid-less numbers
        });
        Editing.insertTermsAt(target, idx, terms);
        deps.setActiveBlockId(target.id); deps.clearSelection();
      });
      return true;
    }

    // ---------- Key dispatch ----------
    function pressKey(k) {
      // Clear the whole canvas
      if (k === 'clear') { deps.clearCanvas(); return; }

      // Keyboard linking: pick up / place a link, or cancel a pending one.
      if (k === 'link') { handleLinkKey(); return; }
      if (k === 'link-cancel') { if (pendingLink) { pendingLink = null; status(''); } return; }

      // Delete the selected (or active) block
      if (k === 'del') {
        var dSel = deps.getSelection();
        var dActive = deps.getActiveBlockId();
        deps.deleteBlock(deps.byId(dSel.blockId) || (dActive ? deps.byId(dActive) : null));
        return;
      }

      // Finish the current block; next input starts a fresh one
      if (k === '=') {
        var eActive = deps.getActiveBlockId();
        var ab = eActive ? deps.byId(eActive) : null;
        if (ab && ab.terms.length === 0) { deps.snapshot(); deps.removeBlock(ab.id); deps.save(); }
        // Commit any still-open groups by writing the matching ')' into the
        // block, so what's on screen matches the (already tolerant) result.
        else if (ab && Editing.unmatchedOpenParens(ab)) { deps.snapshot(); Editing.balanceParens(ab); deps.save(); }
        deps.setActiveBlockId(null); deps.clearSelection(); deps.renderAll();
        return;
      }

      // ± : toggle the selected number/link source, negate a selected result
      // into a linked calculation, or prepare/toggle the active number slot.
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
        } else if (nSel.kind === 'result' && nSel.blockId != null) {
          var nSrcB = deps.byId(nSel.blockId); if (!nSrcB) return;
          // Repeated ± on an existing "-1 * (…)" negation toggles its sign in
          // place rather than stacking yet another negated block.
          if (Editing.isNegationBlock(nSrcB)) {
            deps.commit(function () { Editing.toggleNumberSign(nSrcB.terms[0]); });
            return;
          }
          deps.commit(function () {
            var pt = deps.slotBelow ? deps.slotBelow(nSrcB) : { x: nSrcB.x, y: nSrcB.y + 100 };
            var negBlock = deps.newBlock(deps.snap(pt.x), deps.snap(pt.y));
            negBlock.terms.push(deps.newNumber('-1'));
            negBlock.terms.push({ type: 'operator', value: '*' });
            negBlock.terms.push({ type: 'linked', sourceId: nSrcB.id });
            deps.setActiveBlockId(negBlock.id); deps.clearSelection();
          });
          return;
        } else {
          deps.commit(function () {
            var nBlock = ensureActiveBlock();
            deps.setSelection(Editing.startOrToggleNegativeInput(nBlock, deps.newNumber));
            deps.setActiveBlockId(nBlock.id);
          });
          return;
        }
        if (nt) {
          deps.commit(function () { Editing.toggleNumberSign(nt); });
        }
        return;
      }

      var sel = deps.getSelection();

      // Parentheses: with a selected operand, anchor the paren to that operand;
      // otherwise append to the active block.
      if (k === '(' || k === ')') {
        if ((sel.kind === 'number' || sel.kind === 'linked') && sel.blockId && sel.termIndex !== null) {
          var psb = deps.byId(sel.blockId);
          if (psb && psb.terms[sel.termIndex]) {
            deps.commit(function () {
              Editing.insertParenNearSelection(psb, sel.termIndex, k);
              deps.clearSelection();
              deps.setActiveBlockId(psb.id);
            });
            return;
          }
        }
        deps.commit(function () {
          var pb = ensureActiveBlock();
          Editing.appendParen(pb, k);
          deps.clearSelection(); deps.setActiveBlockId(pb.id);
        });
        return;
      }

      // Missing-operator gap selected -> press an operator to fill it (binds the
      // two adjacent operands); backspace removes the trailing operand instead.
      if (sel.kind === 'missing-op' && sel.blockId && sel.termIndex !== null) {
        var mgb = deps.byId(sel.blockId);
        if (mgb) {
          if (isOp(k)) {
            deps.commit(function () {
              deps.setSelection(Editing.insertOperatorAtGap(mgb, sel.termIndex, k));
              deps.setActiveBlockId(mgb.id);
            });
            return;
          }
          if (k === 'back') {
            deps.commit(function () { deleteTermAndSelectPrev(mgb, sel.termIndex); });
            return;
          }
          return; // ignore other keys while a gap is selected
        }
      }

      // Operator selected -> tap then press a new operator to change it
      if (sel.kind === 'operator' && sel.blockId && sel.termIndex !== null) {
        var obk = deps.byId(sel.blockId);
        var ot = obk && obk.terms[sel.termIndex];
        if (ot && ot.type === 'operator') {
          if (isOp(k)) { deps.commit(function () { Editing.replaceSelectedOperator(obk, sel.termIndex, k); }); return; }
          if (k === 'back') { deps.commit(function () { deleteTermAndSelectPrev(obk, sel.termIndex); }); return; }
          // A digit/dot drops in a new operand after the operator's operand.
          if ((k >= '0' && k <= '9') || k === '.') {
            deps.commit(function () {
              deps.setSelection(Editing.insertNumberAfterOperator(obk, sel.termIndex, k, deps.newNumber));
              deps.setActiveBlockId(obk.id);
            });
            return;
          }
          return; // ignore everything else while an operator is selected
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

      // Number/linked/paren term selected -> edit digits, or backspace-chain (clear, then delete, stepping left)
      if (sel.blockId && sel.termIndex !== null && (k >= '0' && k <= '9' || k === '.' || k === 'back')) {
        var sb = deps.byId(sel.blockId); if (!sb) return;
        var term = sb.terms[sel.termIndex];
        if (term && term.type === 'number') {
          if (k === 'back') {
            deps.commit(function () {
              if (term.value === '') freezeIfReferencedNumber(sb, term); // about to be removed
              applyEditSelection(Editing.backspaceSelectedTerm(sb, sel.termIndex));
            });
            return;
          }
          deps.commit(function () { term.value = Editing.appendDigitValue(term.value, k); });
          return;
        }
        if (term && term.type === 'linked' && k === 'back') {
          deps.commit(function () { applyEditSelection(Editing.backspaceSelectedTerm(sb, sel.termIndex)); }); // unlink & step left
          return;
        }
        if (term && term.type === 'paren' && k === 'back') {
          deps.commit(function () { applyEditSelection(Editing.backspaceSelectedTerm(sb, sel.termIndex)); });
          return;
        }
      }

      // Result selected + operator => create linked block below
      if (sel.kind === 'result' && sel.blockId && isOp(k)) {
        var srcB = deps.byId(sel.blockId); if (!srcB) return;
        deps.commit(function () {
          var pt = deps.slotBelow ? deps.slotBelow(srcB) : { x: srcB.x, y: srcB.y + 100 };
          var nb = deps.newBlock(deps.snap(pt.x), deps.snap(pt.y));
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
          if (backBlock) {
            var lastT = backBlock.terms[backBlock.terms.length - 1];
            // A single-char (or empty) trailing number is removed by this press.
            if (lastT && lastT.type === 'number' && String(lastT.value).length <= 1) {
              freezeIfReferencedNumber(backBlock, lastT);
            }
            applyEditSelection(Editing.backspaceActiveBlock(backBlock));
          }
        });
        return;
      }

      // No active block + operator => start a fresh block that links to the last
      // result, so "= 71" then "+" continues as "71 + …" instead of "0 + …".
      if (isOp(k) && !deps.getActiveBlockId()) {
        var lastB = deps.lastBlock && deps.lastBlock();
        if (lastB && deps.isComplete(lastB.terms)) {
          deps.commit(function () {
            var pt = deps.nextSlot();
            var nb = deps.newBlock(deps.snap(pt.x), deps.snap(pt.y));
            nb.terms.push({ type: 'linked', sourceId: lastB.id });
            nb.terms.push({ type: 'operator', value: k });
            deps.setActiveBlockId(nb.id); deps.clearSelection();
          });
          return;
        }
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
