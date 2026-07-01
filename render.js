/* Canvas Calc - DOM rendering helpers.
 * Owns block rendering, keyed reconciliation, and link drawing.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CanvasRenderer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LINK_PALETTE = ['#c9772f','#3f8f6b','#7b5ea7','#b8456b','#3d7bb0','#9a7b1f','#5a8f3d','#b0568f'];

  var SEP = '\u0001'; // signature field separator (won't appear in user data)

  function create(deps) {
    var doc = deps.document || document;
    var linkColorMap = {};
    // Keyed reconciliation state: a block's DOM element and a signature of every
    // input that affects how it renders. Unchanged blocks are left untouched.
    var blockEls = {};  // id -> element
    var blockSigs = {}; // id -> signature string
    var lastCanvasId = null; // reconcile is keyed by block id, which repeats across canvases
    var SidebarApi = deps.Sidebar || (typeof CanvasSidebar !== 'undefined' ? CanvasSidebar : null);
    var sidebarCtl = SidebarApi ? SidebarApi.create({
      document: doc,
      cur: cur,
      sidebar: deps.sidebar,
      sidebarBody: deps.sidebarBody,
      byId: deps.byId,
      blocksMap: deps.blocksMap,
      getSelection: deps.getSelection,
      getActiveBlockId: deps.getActiveBlockId,
      isComplete: deps.isComplete,
      missingOperatorIndex: deps.missingOperatorIndex,
      diagnose: deps.diagnose,
      fmt: deps.fmt,
      resolve: deps.resolve,
      groupDisplay: deps.groupDisplay,
      blockDefinition: deps.blockDefinition,
      snapshot: deps.snapshot,
      save: deps.save,
      renderAll: renderAll,
      NUM_GROUP: deps.NUM_GROUP,
      NUM_DECIMAL: deps.NUM_DECIMAL
    }) : null;

    // Wipe reconciliation state and any rendered blocks (used when the active
    // canvas changes, since block ids are only unique within a canvas).
    function resetBlocks() {
      Object.keys(blockEls).forEach(function(id){
        var el = blockEls[id]; if (el && el.parentNode) el.parentNode.removeChild(el);
      });
      blockEls = {}; blockSigs = {};
    }

    function cur() { return deps.cur(); }
    function sel() { return deps.getSelection(); }


    // Everything renderBlock() reads for a given block. If this string is equal
    // between renders, the block's DOM is identical and can be skipped. Must
    // include every model-derived input — a missing field means a stale block.
    function blockSig(b, map) {
      var selection = sel();
      var parts = [b.x, b.y, b.label || '', deps.getActiveBlockId() === b.id ? 'A' : '', deps.getFontSize(),
        selection.blockId === b.id ? (selection.termIndex + '/' + selection.kind) : '-'];
      b.terms.forEach(function (t) {
        if (t.type === 'operator') { parts.push('o' + t.value); return; }
        if (t.type === 'paren') { parts.push('p' + t.value); return; }
        if (t.type === 'number') {
          parts.push('n', t.value, t.label || '', linkColorMap[deps.srcKey(b.id, t.tid)] || '');
          return;
        }
        var s = deps.linkedSource(t, map); var lbl = s ? s.getLabel() : '';
        var lv = deps.linkedValue(t, map);
        parts.push('l', t.sourceId, t.sourceTid == null ? '@' : t.sourceTid, lbl || '',
          lv == null ? '?' : lv, linkColorMap[deps.srcKey(t.sourceId, t.sourceTid)] || '');
      });
      var missIdx = deps.missingOperatorIndex(b.terms);
      parts.push('m' + missIdx); // missing-operator marker position
      var diag = deps.diagnose(b, map);
      if (deps.hasResultSlot(b.terms) || diag.status === 'unresolved') {
        parts.push('=', diag.status, diag.reason || '',
          diag.status === 'ok' ? (diag.value == null ? '·' : diag.value) : '?',
          linkColorMap[deps.srcKey(b.id, null)] || '');
      }
      return parts.join(SEP);
    }

    function computeLinkColors() {
      var order = [], seen = {};
      cur().blocks.forEach(function(b){
        b.terms.forEach(function(t){
          if (t.type==='linked') {
            var key = deps.srcKey(t.sourceId, t.sourceTid);
            if (!seen[key]) { seen[key] = true; order.push(key); }
          }
        });
      });
      var map = {};
      order.forEach(function(key, i){ map[key] = LINK_PALETTE[i % LINK_PALETTE.length]; });
      return map;
    }

    function renderAll() {
      if (cur().id !== lastCanvasId) { resetBlocks(); lastCanvasId = cur().id; }
      deps.hint.style.display = cur().blocks.length ? 'none' : '';
      var map = deps.blocksMap();
      linkColorMap = computeLinkColors();

      var present = {};
      cur().blocks.forEach(function(b){ present[b.id] = true; });

      // Drop elements for blocks that no longer exist.
      Object.keys(blockEls).forEach(function(id){
        if (!present[id]) {
          var el = blockEls[id];
          if (el && el.parentNode) el.parentNode.removeChild(el);
          delete blockEls[id]; delete blockSigs[id];
        }
      });

      // Create new blocks and re-render changed ones; skip untouched blocks so
      // their DOM (and any focused caption) survives unrelated edits.
      cur().blocks.forEach(function(b){
        var sig = blockSig(b, map);
        var existing = blockEls[b.id];
        if (existing && blockSigs[b.id] === sig) return;
        var fresh = renderBlock(b, map);
        if (existing && existing.parentNode) existing.parentNode.replaceChild(fresh, existing);
        else deps.canvas.appendChild(fresh);
        blockEls[b.id] = fresh;
        blockSigs[b.id] = sig;
      });

      drawLinks(map);
      deps.updateUndoRedo();
      syncSidebar();
      deps.positionAddBtn();
      deps.updateViewport();
    }

    function blockElById(id) { return blockEls[id] || null; }

    function invalidateBlock(id) {
      delete blockSigs[id];
    }

    function invalidateAll() {
      blockSigs = {};
    }

    // Keyboard selection helpers mirror the pointer selection behavior.
    function selectedTerm(selection, blockId, termIndex) {
      return selection.blockId === blockId && selection.termIndex === termIndex &&
        selection.kind !== 'result' && selection.kind !== 'missing-op';
    }

    function appendCaret(parent, className) {
      var cue = doc.createElement('span');
      cue.className = className;
      cue.setAttribute('aria-hidden', 'true');
      cue.title = 'Next input inserts here';
      parent.className += ' has-caret';
      parent.appendChild(cue);
    }

    function appendSelectionCue(parent) { appendCaret(parent, 'selection-caret'); }
    function appendInputCue(parent) { appendCaret(parent, 'expr-caret'); }

    // Inline +/-/×/÷ chooser for a selected missing-operator gap.
    function buildOpPicker(blockId, idx) {
      var pick = doc.createElement('span');
      pick.className = 'op-picker';
      ['+', '-', '*', '/'].forEach(function (opv) {
        var ob = doc.createElement('button');
        ob.type = 'button';
        ob.className = 'op-pick';
        ob.textContent = deps.opSym(opv);
        ob.dataset.op = opv;
        ob.title = 'Insert ' + deps.opSym(opv);
        ob.setAttribute('aria-label', 'Insert ' + deps.opSym(opv));
        // Swallow the pointerdown so the block's drag/long-press logic stays idle.
        ob.addEventListener('pointerdown', function (e) { e.stopPropagation(); e.preventDefault(); });
        ob.addEventListener('click', function (e) { e.stopPropagation(); deps.fillMissingOp(blockId, idx, opv); });
        pick.appendChild(ob);
      });
      return pick;
    }

    function selectFromKeyboard(e, blockId, termIndex, kind) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      deps.setSelection({ blockId: blockId, termIndex: termIndex, kind: kind });
      deps.setActiveBlockId(blockId);
      renderAll();
    }

    function makeSelectable(el, label, blockId, termIndex, kind) {
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', label);
      el.addEventListener('keydown', function(e){ selectFromKeyboard(e, blockId, termIndex, kind); });
    }

    // An editable caption that bonds a label to a value chip.
    function makeCaption(getText, setText, label) {
      var cap = doc.createElement('span');
      cap.className = 'cap';
      cap.contentEditable = 'true';
      cap.tabIndex = 0;
      cap.spellcheck = false;
      cap.setAttribute('role', 'textbox');
      cap.setAttribute('aria-label', label || 'Name value');
      var txt = getText() || '';
      cap.textContent = txt;
      cap.title = txt || (label || 'Name value');
      cap.addEventListener('pointerdown', function(e){
        e.stopPropagation();
        if (doc.activeElement !== cap) {
          e.preventDefault();
          cap.focus();
          var r = doc.createRange(); r.selectNodeContents(cap); r.collapse(false);
          var sn = window.getSelection(); sn.removeAllRanges(); sn.addRange(r);
        }
      });
      cap.addEventListener('click', function(e){
        e.stopPropagation();
        if (doc.activeElement !== cap) cap.focus();
      });
      cap.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); cap.blur(); } });
      cap.addEventListener('blur', function(){
        if (getText() !== cap.textContent) { deps.snapshot(); setText(cap.textContent); deps.save(); renderAll(); }
      });
      return cap;
    }

    function renderBlock(b, map) {
      var el = doc.createElement('div');
      var selection = sel();
      el.className = 'block';
      if (!b.terms.length) el.className += ' empty-draft';
      if (selection.blockId===b.id && selection.kind==='result') el.className += ' selected';
      if (deps.getActiveBlockId()===b.id) el.className += ' active';
      el.style.left = b.x + 'px';
      el.style.top = b.y + 'px';
      el.style.setProperty('--fs', deps.getFontSize() + 'px');
      el.dataset.id = b.id;

      var del = doc.createElement('button');
      del.className = 'block-del';
      del.type = 'button';
      del.textContent = '×';
      del.setAttribute('aria-label', 'Delete block');
      del.addEventListener('pointerdown', function(e){ e.stopPropagation(); e.preventDefault(); });
      del.addEventListener('click', function(e){ e.stopPropagation(); deps.deleteBlock(deps.byId(b.id)); });
      el.appendChild(del);

      var expr = doc.createElement('div');
      expr.className = 'expr';
      var missIdx = deps.missingOperatorIndex(b.terms);
      var activeTailIdx = (deps.getActiveBlockId()===b.id && sel().blockId !== b.id && b.terms.length) ? b.terms.length - 1 : -1;
      b.terms.forEach(function(t, idx){
        selection = sel();
        // A gap where an operator is expected (two operands with none between).
        if (idx === missIdx) {
          var gap = doc.createElement('span');
          gap.className = 'op-missing';
          var gapSelected = selection.blockId === b.id && selection.kind === 'missing-op' && selection.termIndex === missIdx;
          if (gapSelected) gap.className += ' sel';
          gap.textContent = '?';
          gap.dataset.idx = missIdx;
          gap.title = gapSelected ? 'Pick an operator to fill the gap' : 'Operator missing — tap to add one';
          makeSelectable(gap, gap.title, b.id, missIdx, 'missing-op');
          expr.appendChild(gap);
          // Selecting the gap reveals an inline picker, so the repair action is
          // visible instead of relying on the user knowing to press a keypad operator.
          if (gapSelected) expr.appendChild(buildOpPicker(b.id, missIdx));
        }
        if (t.type==='operator') {
          var op = doc.createElement('span');
          op.className = 'term operator';
          var opSelected = selectedTerm(selection, b.id, idx);
          if (opSelected && selection.kind==='operator') op.className += ' sel';
          op.textContent = deps.opSym(t.value);
          op.dataset.idx = idx;
          op.title = opSelected ? 'Selected operator' : 'Select operator';
          makeSelectable(op, op.title, b.id, idx, 'operator');
          expr.appendChild(op);
          if (opSelected) appendSelectionCue(op);
          else if (idx === activeTailIdx) appendInputCue(op);
          return;
        }
        if (t.type==='paren') {
          var pp = doc.createElement('span');
          pp.className = 'term paren';
          var parenSelected = selectedTerm(selection, b.id, idx);
          if (parenSelected && selection.kind==='paren') pp.className += ' sel';
          pp.textContent = t.value;
          pp.dataset.idx = idx;
          pp.title = parenSelected ? 'Selected parenthesis' : 'Select parenthesis';
          makeSelectable(pp, pp.title, b.id, idx, 'paren');
          expr.appendChild(pp);
          if (parenSelected) appendSelectionCue(pp);
          else if (idx === activeTailIdx) appendInputCue(pp);
          return;
        }
        var cell = doc.createElement('span');
        cell.className = 'cell';
        var capGet, capSet;
        if (t.type==='linked') {
          capGet = function(){ var s=deps.linkedSource(t, deps.blocksMap()); return s ? s.getLabel() : ''; };
          capSet = function(v){ var s=deps.linkedSource(t, deps.blocksMap()); if(s) s.setLabel(v); };
        } else {
          capGet = function(){ return t.label; };
          capSet = function(v){ var nb=deps.byId(b.id); if(nb) nb.terms[idx].label = v; };
        }
        cell.appendChild(makeCaption(capGet, capSet, t.type==='linked' ? 'Name linked value' : 'Name number'));
        var span = doc.createElement('span');
        var termSelected = selectedTerm(selection, b.id, idx);
        if (termSelected) span.className = ' sel';
        if (t.type==='number') {
          span.className = 'term number' + span.className;
          span.textContent = deps.groupDisplay(t.value);
          span.title = termSelected ? 'Selected number' : 'Select or drag this number';
          var nkey = deps.srcKey(b.id, t.tid);
          if (linkColorMap[nkey]) span.style.boxShadow = 'inset 0 -3px 0 0 ' + linkColorMap[nkey] + ', inset 0 0 0 1px ' + linkColorMap[nkey] + '59';
        } else {
          span.className = 'term linked' + span.className;
          var lv = deps.linkedValue(t, map);
          span.textContent = (lv==null) ? '?' : deps.fmt(lv);
          span.dataset.linked = '1';
          span.title = termSelected ? 'Selected linked value' : 'Select linked value';
          var lkey = deps.srcKey(t.sourceId, t.sourceTid);
          var lc = linkColorMap[lkey];
          if (lc) {
            span.style.color = lc;
            // Opaque tint (the colour composited over the block) so the dotted
            // link line behind the chip doesn't bleed through its body.
            span.style.background = 'color-mix(in srgb, ' + lc + ' 18%, var(--block))';
            span.style.boxShadow = 'inset 0 0 0 2px ' + lc + '99, 0 1px 5px ' + lc + '26';
          }
        }
        span.dataset.idx = idx;
        makeSelectable(span, span.title, b.id, idx, t.type==='linked' ? 'linked' : 'number');
        cell.appendChild(span);
        expr.appendChild(cell);
        if (termSelected) appendSelectionCue(span);
        else if (idx === activeTailIdx) appendInputCue(span);
      });

      var diag = deps.diagnose(b, map);
      if (deps.hasResultSlot(b.terms) || diag.status === 'unresolved') {
        var unresolved = diag.status === 'unresolved';
        var val = unresolved ? null : diag.value;
        var eq = doc.createElement('span'); eq.className='eq'; eq.textContent='=';
        expr.appendChild(eq);

        var rcell = doc.createElement('span');
        rcell.className = 'cell result-cell';
        rcell.appendChild(makeCaption(
          function(){ return b.label; },
          function(v){ var nb=deps.byId(b.id); if(nb) nb.label = v; },
          'Name result'
        ));
        var res = doc.createElement('span');
        selection = sel();
        if (unresolved) {
          // An unresolved block shows "?" (not a draggable/linkable result) so a
          // half-finished or broken expression never reads as a real answer. When
          // the engine knows why, a soft caption explains how to fix it.
          res.className = 'result pending';
          res.textContent = '?';
          if (diag.message) {
            res.title = diag.message;
            res.setAttribute('aria-describedby', 'why-' + b.id);
          }
        } else {
          res.className = 'result' + (val===null?' empty':'');
          if (selection.blockId===b.id && selection.kind==='result') res.className += ' sel';
          res.textContent = val===null ? '·' : deps.fmt(val);
          res.dataset.result = '1';
          res.dataset.id = b.id;
          res.title = selection.blockId===b.id && selection.kind==='result' ? 'Selected result' : 'Select or drag this result';
          makeSelectable(res, res.title, b.id, null, 'result');
          var rkey = deps.srcKey(b.id, null);
          if (linkColorMap[rkey]) res.style.boxShadow = 'inset 0 -3px 0 0 ' + linkColorMap[rkey] + ', inset 0 0 0 1px ' + linkColorMap[rkey] + '59';
        }
        rcell.appendChild(res);
        if (unresolved && diag.message) {
          var why = doc.createElement('span');
          why.className = 'result-why';
          why.id = 'why-' + b.id;
          why.textContent = diag.message;
          rcell.appendChild(why);
        }
        expr.appendChild(rcell);
      }

      el.appendChild(expr);
      return el;
    }

    function offsetIn(el, ancestor) {
      var x=0, y=0;
      while (el && el!==ancestor) { x+=el.offsetLeft; y+=el.offsetTop; el=el.offsetParent; }
      return { x:x, y:y };
    }

    function drawLinks(map) {
      while (deps.linkLayer.firstChild) deps.linkLayer.removeChild(deps.linkLayer.firstChild);
      cur().blocks.forEach(function(b){
        b.terms.forEach(function(t, idx){
          if (t.type!=='linked') return;
          var src = map[t.sourceId]; if(!src) return;
          var srcEl = blockElById(src.id);
          var dstEl = blockElById(b.id);
          if (!srcEl||!dstEl) return;
          var srcRes;
          if (t.sourceTid != null) {
            var si=-1; for (var ii=0; ii<src.terms.length; ii++){ if (src.terms[ii].type==='number' && src.terms[ii].tid===t.sourceTid){ si=ii; break; } }
            srcRes = si>=0 ? srcEl.querySelectorAll('.term')[si] : null;
          } else {
            srcRes = srcEl.querySelector('.result:not(.pending)');
          }
          var dstTerm = dstEl.querySelectorAll('.term')[idx];
          if (!srcRes||!dstTerm) return;
          var so = offsetIn(srcRes, srcEl), to = offsetIn(dstTerm, dstEl);
          var x1 = src.x + so.x + srcRes.offsetWidth/2;
          var y1 = src.y + so.y + srcRes.offsetHeight/2;
          var x2 = b.x + to.x + dstTerm.offsetWidth/2;
          var y2 = b.y + to.y + dstTerm.offsetHeight/2;
          var svgNS = 'http://www.w3.org/2000/svg';
          var col = linkColorMap[deps.srcKey(t.sourceId, t.sourceTid)] || 'var(--accent)';
          var path = doc.createElementNS(svgNS,'path');
          var dx = Math.abs(x2-x1)*0.4;
          path.setAttribute('d','M '+x1+' '+y1+' C '+(x1+dx)+' '+y1+' '+(x2-dx)+' '+y2+' '+x2+' '+y2);
          path.setAttribute('fill','none');
          path.setAttribute('stroke', col);
          path.setAttribute('stroke-width','3');
          path.setAttribute('stroke-linecap','round');
          path.setAttribute('stroke-dasharray','0.1 5');
          path.setAttribute('opacity','0.95');
          deps.linkLayer.appendChild(path);
          // Solid endpoint dots anchor the dotted link to its source and target.
          [[x1,y1,3.4],[x2,y2,3.8]].forEach(function(p){
            var dot = doc.createElementNS(svgNS,'circle');
            dot.setAttribute('cx', p[0]); dot.setAttribute('cy', p[1]); dot.setAttribute('r', p[2]);
            dot.setAttribute('fill', col);
            deps.linkLayer.appendChild(dot);
          });
        });
      });
    }

    function layoutOverlays() {
      var win = doc.defaultView || window;
      var wide = win.matchMedia && win.matchMedia('(min-width: 760px)').matches;
      var h = (!wide && !deps.numpad.classList.contains('hidden')) ? deps.numpad.offsetHeight : 0;
      deps.sidebar.style.bottom = h + 'px';
      deps.zoomCtl.style.bottom = (wide ? 18 : h + 12) + 'px';
      // The empty-canvas hint is a band over the visible canvas (toolbar to
      // keypad), so its contents centre in the space the user actually sees.
      if (deps.hint) deps.hint.style.bottom = h + 'px';

      // The link tip is a transient hint that must never float in dead canvas or
      // collide with the keypad. Anchor it just above the keypad: right-aligned
      // over the docked keypad on wide screens, centred above the full-width
      // keypad on narrow ones. Measuring the keypad keeps it correct whether the
      // keypad is expanded or collapsed to its tab.
      if (deps.linkTip) {
        var pad = deps.numpad;
        var clearance;
        if (pad.classList.contains('hidden')) {
          clearance = 44; // only the pull tab pokes above the bottom edge
        } else {
          var top = pad.getBoundingClientRect().top;
          clearance = Math.max(44, (win.innerHeight - top) + 10);
        }
        var tip = deps.linkTip;
        if (wide) {
          tip.style.left = 'auto'; tip.style.right = '18px'; tip.style.transform = 'none';
        } else {
          tip.style.left = '50%'; tip.style.right = 'auto'; tip.style.transform = 'translateX(-50%)';
          // On narrow screens the centred tip would sit on top of the bottom-left
          // zoom control (same band above the keypad); lift it clear of that too.
          if (deps.zoomCtl) {
            var zTop = deps.zoomCtl.getBoundingClientRect().top;
            if (zTop) clearance = Math.max(clearance, (win.innerHeight - zTop) + 10);
          }
        }
        tip.style.bottom = clearance + 'px';
      }
    }

    function syncSidebar() {
      if (sidebarCtl) sidebarCtl.syncSidebar();
    }

    function renderSidebar() {
      if (sidebarCtl) sidebarCtl.renderSidebar();
    }

    return {
      renderAll: renderAll,
      blockEl: blockElById,
      invalidateBlock: invalidateBlock,
      invalidateAll: invalidateAll,
      drawLinks: drawLinks,
      layoutOverlays: layoutOverlays,
      renderSidebar: renderSidebar,
      syncSidebar: syncSidebar
    };
  }

  return { create: create };
});
