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
    function resultIsLinkable(block) {
      if (!block) return false;
      if (deps.diagnose) return deps.diagnose(block, deps.blocksMap()).status === 'ok';
      return !deps.isComplete || deps.isComplete(block.terms);
    }
    function rejectUnlinkableResult() {
      status('Fix this result before linking it.');
    }
    function linkSourceFromSelection(sel) {
      if (sel.blockId == null) return null;
      if (sel.kind === 'result') {
        if (!resultIsLinkable(deps.byId(sel.blockId))) return { blocked: true };
        return { sourceId: sel.blockId, sourceTid: null };
      }
      if (sel.termIndex == null) return null;
      var b = deps.byId(sel.blockId), t = b && b.terms[sel.termIndex];
      if (!t) return null;
      if (sel.kind === 'number' && t.type === 'number') return { sourceId: sel.blockId, sourceTid: t.tid };
      if (sel.kind === 'linked' && t.type === 'linked') return { sourceId: t.sourceId, sourceTid: t.sourceTid }; // chain
      return null;
    }
    function placePendingLink(sel) {
      var src = pendingLink;
      // The source can be deleted between pickup and placement (it stays selected
      // after L, so Delete reaches it). Never commit a link to a vanished source.
      if (!sourcePresent({ type: 'linked', sourceId: src.sourceId, sourceTid: src.sourceTid }, deps.blocksMap())) {
        pendingLink = null;
        status('Link cancelled — the value is no longer available.');
        return;
      }
      var target = sel.blockId != null ? deps.byId(sel.blockId) : null;
      if (!target) { status('Select a target slot, then press L to place the link.'); return; }
      var idx;
      if (sel.kind === 'missing-op') idx = sel.termIndex;     // fill the gap
      else if (sel.termIndex != null) idx = sel.termIndex + 1; // just after the selected term
      else idx = target.terms.length;                         // result selected / no term: append
      if (target.id === src.sourceId) {
        pendingLink = null;
        status('Can\'t link a value back into its own block.');
        return;
      }
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
        if (src && src.blocked) { rejectUnlinkableResult(); return; }
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
    // In-memory structural clipboard so an in-app copy can be pasted back as live
    // links rather than flattened numbers. Matched against the system clipboard
    // text on paste, so external text still parses normally and our own copy is
    // only rebuilt when the clipboard still holds exactly what we wrote.
    var internalClip = null; // { text, terms }

    function cloneTermForClip(t) {
      if (t.type === 'number') return { type: 'number', value: t.value };
      if (t.type === 'linked') {
        // Remember the value now, so if the source is gone by paste time the link
        // freezes to what it actually showed when copied, not 0.
        var lv = deps.linkedValue(t, deps.blocksMap());
        return { type: 'linked', sourceId: t.sourceId, sourceTid: t.sourceTid,
          frozen: lv == null ? 0 : Math.round(lv * 1e10) / 1e10 };
      }
      return { type: t.type, value: t.value };
    }
    // The terms the current selection represents (single value, or a whole block).
    function selectionTerms() {
      var sel = deps.getSelection();
      if (sel.blockId != null && sel.termIndex != null && (sel.kind === 'number' || sel.kind === 'linked')) {
        var b = deps.byId(sel.blockId), t = b && b.terms[sel.termIndex];
        return t ? [cloneTermForClip(t)] : null;
      }
      var activeBlockId = deps.getActiveBlockId();
      var rb = (sel.kind === 'result' && sel.blockId != null) ? deps.byId(sel.blockId)
             : (activeBlockId ? deps.byId(activeBlockId) : null);
      return rb && rb.terms.length ? rb.terms.map(cloneTermForClip) : null;
    }
    // Capture the selection both as text (for the system clipboard / external
    // apps) and as structure (for same-session link-preserving paste).
    function copySelection() {
      var text = currentSelectionText();
      if (text == null || text === '') { internalClip = null; return null; }
      internalClip = { text: text, terms: selectionTerms() };
      return text;
    }

    function sourcePresent(t, map) {
      var src = map[t.sourceId];
      if (!src) return false;
      if (t.sourceTid == null) return true; // result link: the block still exists
      for (var i = 0; i < src.terms.length; i++) {
        if (src.terms[i].type === 'number' && src.terms[i].tid === t.sourceTid) return true;
      }
      return false;
    }
    // Turn clipped terms into insertable terms: keep a link live when its source
    // still exists and wouldn't loop into the target; otherwise freeze it to its
    // last value so the paste is always a valid expression.
    function rebuildClip(terms, target) {
      var map = deps.blocksMap();
      return terms.map(function (t) {
        if (t.type !== 'linked') return { type: t.type, value: t.value };
        var cycles = t.sourceTid == null && target && deps.createsCycle && deps.createsCycle(target.id, t.sourceId);
        if (sourcePresent(t, map) && !cycles && (!target || t.sourceId !== target.id)) {
          return { type: 'linked', sourceId: t.sourceId, sourceTid: t.sourceTid };
        }
        var lv = deps.linkedValue(t, map);
        var v = lv == null ? (t.frozen != null ? t.frozen : 0) : Math.round(lv * 1e10) / 1e10;
        return { type: 'number', value: String(v) };
      });
    }

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

    // ---------- Structured export ----------
    function quoteText(v) {
      return JSON.stringify(String(v == null ? '' : v));
    }
    function labelSuffix(v) {
      return v ? ' ' + quoteText(v) : '';
    }
    function refFor(blockId, tokenId) {
      return '@' + blockId + '#' + tokenId;
    }
    function blockRef(b) {
      return '@' + (b && b.id ? b.id : 'missing');
    }
    function termRef(block, term) {
      return term && term.tid ? refFor(block.id, term.tid) : blockRef(block) + '#term';
    }
    function valueText(v) {
      if (v == null) return '?';
      return deps.fmt ? deps.fmt(v) : String(v);
    }
    function sourceRef(term) {
      return refFor(term.sourceId, term.sourceTid == null ? 'result' : term.sourceTid);
    }
    function formulaToken(block, term) {
      if (term.type === 'number') return termRef(block, term);
      if (term.type === 'linked') return sourceRef(term);
      return String(term.value);
    }
    function formulaText(block) {
      return block.terms.map(function (term) { return formulaToken(block, term); }).join(' ');
    }
    function linkedRefs(block) {
      var refs = [], seen = {};
      block.terms.forEach(function (term) {
        if (term.type !== 'linked') return;
        var ref = sourceRef(term);
        if (!seen[ref]) { seen[ref] = true; refs.push(ref); }
      });
      return refs;
    }
    function usedByRefs(block) {
      var refs = [], seen = {};
      deps.cur().blocks.forEach(function (other) {
        if (!other || other.id === block.id) return;
        for (var i = 0; i < other.terms.length; i++) {
          var term = other.terms[i];
          if (term.type === 'linked' && term.sourceId === block.id) {
            var ref = blockRef(other);
            if (!seen[ref]) { seen[ref] = true; refs.push(ref); }
            return;
          }
        }
      });
      return refs;
    }
    function describeTerm(block, term, map) {
      if (term.type === 'number') {
        return '- ' + termRef(block, term) + ' number' + labelSuffix(term.label) +
          ' = ' + (term.value === '' ? '0' : term.value);
      }
      if (term.type === 'operator') return '- ' + term.value + ' operator';
      if (term.type === 'paren') return '- ' + term.value + ' paren';
      if (term.type === 'linked') {
        var src = map[term.sourceId];
        var kind = term.sourceTid == null ? 'result' : 'number';
        var label = '';
        if (src && term.sourceTid == null) label = src.label || '';
        else if (src) {
          var sourceTerm = deps.findTermByTid ? deps.findTermByTid(src, term.sourceTid) : null;
          label = sourceTerm && sourceTerm.label ? sourceTerm.label : '';
        }
        var lv = deps.linkedValue(term, map);
        return '- ' + sourceRef(term) + ' linked ' + kind + labelSuffix(label) + ' = ' + valueText(lv);
      }
      return '- unknown token';
    }
    function currentBlockForStructuredExport() {
      var sel = deps.getSelection();
      if (sel.blockId != null) return deps.byId(sel.blockId);
      var activeBlockId = deps.getActiveBlockId();
      return activeBlockId ? deps.byId(activeBlockId) : null;
    }
    function structuredBlockText(block) {
      block = block || currentBlockForStructuredExport();
      if (!block || !block.terms || !block.terms.length) return null;
      var map = deps.blocksMap();
      var diag = deps.diagnose ? deps.diagnose(block, map) : { status: 'ok', value: deps.resolve ? deps.resolve(block, map) : null };
      var lines = [
        'Canvas Calc Block v1',
        'block: ' + blockRef(block) + labelSuffix(block.label),
        'status: ' + diag.status + (diag.reason ? ' (' + diag.reason + ')' : ''),
        'result: ' + (diag.status === 'ok' ? valueText(diag.value) : (diag.status === 'unresolved' ? '?' : 'none')),
        'formula: ' + formulaText(block),
        'depends-on: ' + (linkedRefs(block).join(', ') || 'none'),
        'used-by: ' + (usedByRefs(block).join(', ') || 'none'),
        'tokens:'
      ];
      block.terms.forEach(function (term) { lines.push(describeTerm(block, term, map)); });
      if (diag.message) lines.push('message: ' + diag.message);
      return lines.join('\n');
    }
    function structuredCanvasText() {
      var canvas = deps.cur();
      var map = deps.blocksMap();
      var lines = [
        'Canvas Calc Summary v1',
        'canvas: @' + canvas.id + labelSuffix(canvas.title),
        'blocks: ' + canvas.blocks.length
      ];
      canvas.blocks.forEach(function (block) {
        var diag = deps.diagnose ? deps.diagnose(block, map) : { status: 'ok', value: deps.resolve ? deps.resolve(block, map) : null };
        lines.push('- ' + blockRef(block) + labelSuffix(block.label) + ' ' + diag.status +
          ' = ' + (diag.status === 'ok' ? valueText(diag.value) : (diag.status === 'unresolved' ? '?' : 'none')) +
          ' :: ' + formulaText(block));
      });
      return lines.join('\n');
    }

    // Insert parsed terms at the current selection/gap, or append to the active
    // block (or a new one) when nothing is selected. Insertion glues with '+' so
    // it never overwrites a term — the same rule as a drag-drop insert.
    function pasteText(text) {
      var isInternal = !!(internalClip && internalClip.terms && internalClip.text === text);
      var rawTerms = isInternal ? internalClip.terms : deps.parseExpression(text);
      if (!rawTerms || !rawTerms.length) return false;
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
        // Internal paste rebuilds live links (relative to the target); external
        // text is just the parsed terms.
        var terms = isInternal ? rebuildClip(rawTerms, target) : rawTerms;
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
            else if (nSel.kind === 'linked') {
              nt = linkedSourceNumber(nb_.terms[ni]);
              if (nt && deps.notifyLinkedNeg) deps.notifyLinkedNeg(); // one-time "edits the source" hint
            }
          }
          if (!nt) return;
        } else if (nSel.kind === 'result' && nSel.blockId != null) {
          var nSrcB = deps.byId(nSel.blockId); if (!nSrcB) return;
          if (!resultIsLinkable(nSrcB)) { rejectUnlinkableResult(); return; }
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
        if (!resultIsLinkable(srcB)) { rejectUnlinkableResult(); return; }
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
        if (lastB && resultIsLinkable(lastB)) {
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
      currentSelectionText: currentSelectionText,
      copySelection: copySelection,
      structuredBlockText: structuredBlockText,
      structuredCanvasText: structuredCanvasText
    };
  }

  return { create: create };
});
