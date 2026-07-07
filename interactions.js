/* Canvas Calc - pointer, drag/link, and touch interaction wiring. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CanvasInteractions = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(deps) {
    var doc = deps.document || document;
    var Editing = deps.Editing;
    var pointer = { mode:null, startX:0, startY:0, block:null, moved:false, linkSrc:null, pendingSelect:null };
    var pinchPts = {}, pinch = null;
    var lpTimer = null;
    var dropCaret = null;
    var TOUCH_DROP_Y_OFFSET = 48;

    function pinchCount(){ return Object.keys(pinchPts).length; }
    function pinching(){ return !!pinch; }

    function resetPointer() { pointer = { mode:null }; }

    function clearTargets(){
      deps.canvas.querySelectorAll('.drop-ok, .drop-invalid').forEach(function(e){
        e.classList.remove('drop-ok', 'drop-invalid');
      });
    }

    // A thin insertion caret shown between terms while dragging a link, so the
    // exact drop position is visible before release. One reused node, injected
    // into the live block DOM (pointermove never re-renders) and removed on the
    // next move / on drop. pointer-events:none keeps it out of elementFromPoint.
    function clearCaret(){ if (dropCaret && dropCaret.parentNode) dropCaret.parentNode.removeChild(dropCaret); }
    function exprNodeForIdx(expr, idx){
      var el = expr.querySelector('[data-idx="' + idx + '"]');
      if (!el) return null;
      return el.closest('.cell') || el; // number/linked spans live inside a .cell
    }
    function showCaretAt(blockEl, idx){
      var expr = blockEl.querySelector('.expr'); if (!expr) return;
      if (!dropCaret) { dropCaret = doc.createElement('span'); dropCaret.className = 'drop-caret'; }
      var ref = exprNodeForIdx(expr, idx);
      if (ref) { expr.insertBefore(dropCaret, ref); return; }
      var eq = expr.querySelector('.eq');                 // append: land before the "=" result
      if (eq) expr.insertBefore(dropCaret, eq); else expr.appendChild(dropCaret);
    }

    function nearbyInsertionTerm(bEl, clientX, clientY) {
      if (!bEl) return null;
      var terms = Array.prototype.slice.call(bEl.querySelectorAll('.expr .term, .expr .op-missing'));
      if (!terms.length) return null;
      var pad = pointer.touch ? 28 : 10;
      var best = null;
      terms.forEach(function(el){
        if (el.dataset.idx == null) return;
        var r = el.getBoundingClientRect();
        if (clientY < r.top - pad || clientY > r.bottom + pad) return;
        var centerX = r.left + r.width / 2;
        var dx = clientX < r.left ? r.left - clientX : (clientX > r.right ? clientX - r.right : 0);
        var score = dx + Math.abs(clientY - (r.top + r.height / 2)) * 0.35;
        if (!best || score < best.score) {
          best = {
            el: el,
            idx: parseInt(el.dataset.idx, 10) + (clientX > centerX ? 1 : 0),
            score: score
          };
        }
      });
      return best;
    }

    // Resolve a pointer position to an insertion point: the block under the
    // cursor plus the term index a dropped link should be inserted *before*
    // (cursor-relative, so the right half of a chip inserts after it). Always an
    // insertion — never a term to overwrite. idx === terms.length means append.
    function resolveDrop(clientX, clientY) {
      var under = doc.elementFromPoint(clientX, clientY);
      var bUnder = under && under.closest && under.closest('.block');
      var blk = bUnder && deps.byId(bUnder.dataset.id);
      if (!blk) return { blockEl: null, block: null, idx: null };
      var nearby = nearbyInsertionTerm(bUnder, clientX, clientY);
      return { blockEl: bUnder, block: blk, idx: nearby ? nearby.idx : blk.terms.length };
    }

    function linkIntentPoint(e) {
      return {
        x: e.clientX,
        y: pointer.touch ? e.clientY - TOUCH_DROP_Y_OFFSET : e.clientY
      };
    }

    // A drop is invalid if it targets the link's own source block, or would
    // close a dependency loop. Such zones are flagged softly; release is a no-op
    // (self) or shows the loop explanation (cycle).
    function dropInvalid(tb) {
      var ls = pointer.linkSrc;
      if (tb.id === ls.sourceId) return true;
      if (ls.sourceTid == null && deps.createsCycle(tb.id, ls.sourceId)) return true;
      return false;
    }

    // Insert a dragged value just before the term at `idx`, gluing it to its
    // neighbours with '+' wherever two operands would otherwise touch — so
    // dropping onto the leading "×" of "× 2.6" yields "15 × 2.6", and a drop
    // between operands stays a well-formed expression.
    function insertLinkBefore(tb, idx, link){
      var seq = [link];
      var at = tb.terms[idx];
      var before = tb.terms[idx-1];
      if (at && at.type!=='operator' && !(at.type==='paren' && at.value===')')) seq.push({type:'operator', value:'+'});
      if (before && before.type!=='operator' && !(before.type==='paren' && before.value==='(')) seq.unshift({type:'operator', value:'+'});
      Array.prototype.splice.apply(tb.terms, [idx, 0].concat(seq));
    }

    function toCanvas(clientX, clientY){
      var r = deps.canvas.getBoundingClientRect();
      return { x: (clientX - r.left)/deps.getZoom(), y: (clientY - r.top)/deps.getZoom() };
    }

    function flashCycle(){
      deps.confirmDialog('Can\u2019t link these \u2014 it would create a loop where a result depends on itself.', function(){}, 'Got it');
      var row = doc.getElementById('toastRow');
      row.firstChild.style.display='none';
      row.lastChild.focus();
    }

    deps.wrap.addEventListener('pointerdown', function(e){
      if (pinching()) return;
      var target = e.target;
      if (target.closest && target.closest('#zoomCtl')) return;

      var resEl = target.closest && target.closest('.result');
      if (resEl && !resEl.classList.contains('empty') && !resEl.classList.contains('pending') && resEl.dataset.id) {
        pointer.mode='maybe-link'; pointer.startX=e.clientX; pointer.startY=e.clientY;
        pointer.linkSrc = { sourceId: resEl.dataset.id, sourceTid: null }; pointer.moved=false;
        pointer.ghostText = resEl.textContent; pointer.pendingSelect = null;
        pointer.touch = e.pointerType==='touch';
        return;
      }

      var gapEl = target.closest && target.closest('.op-missing');
      if (gapEl) {
        var gblk = gapEl.closest('.block');
        deps.setSelection({ blockId: gblk.dataset.id, termIndex: parseInt(gapEl.dataset.idx,10), kind: 'missing-op' });
        deps.setActiveBlockId(gblk.dataset.id);
        deps.renderAll();
        e.preventDefault();
        return;
      }

      var termEl = target.closest && target.closest('.term');
      if (termEl && termEl.classList.contains('number')) {
        var nblk = termEl.closest('.block');
        var nbid = nblk.dataset.id;
        var nidx = parseInt(termEl.dataset.idx,10);
        var nsrc = deps.byId(nbid);
        var ntid = (nsrc && nsrc.terms[nidx]) ? nsrc.terms[nidx].tid : null;
        pointer.mode='maybe-link'; pointer.startX=e.clientX; pointer.startY=e.clientY; pointer.moved=false;
        pointer.linkSrc = { sourceId: nbid, sourceTid: ntid };
        pointer.ghostText = termEl.textContent;
        pointer.pendingSelect = { blockId: nbid, termIndex: nidx, kind: 'number' };
        pointer.touch = e.pointerType==='touch';
        return;
      }

      if (termEl && termEl.classList.contains('linked')) {
        var lblk = termEl.closest('.block');
        deps.setSelection({ blockId: lblk.dataset.id, termIndex: parseInt(termEl.dataset.idx,10), kind: 'linked' });
        deps.setActiveBlockId(lblk.dataset.id);
        deps.renderAll();
        e.preventDefault();
        return;
      }

      if (termEl && termEl.classList.contains('operator')) {
        var oblk = termEl.closest('.block');
        deps.setSelection({ blockId: oblk.dataset.id, termIndex: parseInt(termEl.dataset.idx,10), kind: 'operator' });
        deps.setActiveBlockId(oblk.dataset.id);
        deps.renderAll();
        e.preventDefault();
        return;
      }

      if (termEl && termEl.classList.contains('paren')) {
        var pblk = termEl.closest('.block');
        deps.setSelection({ blockId: pblk.dataset.id, termIndex: parseInt(termEl.dataset.idx,10), kind: 'paren' });
        deps.setActiveBlockId(pblk.dataset.id);
        deps.renderAll();
        e.preventDefault();
        return;
      }

      if (target.closest && target.closest('.cap')) return;

      var bEl = target.closest && target.closest('.block');
      if (bEl) {
        pointer.mode='drag-block'; pointer.block=deps.byId(bEl.dataset.id);
        pointer.startX=e.clientX; pointer.startY=e.clientY;
        pointer.origX=pointer.block.x; pointer.origY=pointer.block.y;
        pointer.moved=false; pointer.snapshotted=false;
        deps.setSelection({ blockId:pointer.block.id, termIndex:null, kind:'result' });
        if (deps.invalidateBlock) deps.invalidateBlock(pointer.block.id);
        deps.canvas.querySelectorAll('.selected, .sel').forEach(function(x){ x.classList.remove('selected','sel'); });
        bEl.classList.add('selected');
        var rc = bEl.querySelector('.result'); if (rc) rc.classList.add('sel');
        bEl.setPointerCapture && bEl.setPointerCapture(e.pointerId);
        return;
      }

      pointer.mode='maybe-tap';
      pointer.startX=e.clientX; pointer.startY=e.clientY; pointer.moved=false;
      // Capture the starting state before other pointerdown handlers blur an
      // editor or close a menu. A tap from any non-idle state — active block,
      // selection, focused text entry (block caption, canvas rename), or an
      // open overlay menu — only dismisses; it must never also create a draft
      // block underneath the user's finger.
      var ae0 = doc.activeElement;
      var typing0 = !!(ae0 && (ae0.isContentEditable ||
        ae0.tagName === 'INPUT' || ae0.tagName === 'TEXTAREA'));
      pointer.hadFocus = !!(deps.getActiveBlockId() ||
        (deps.getSelection && deps.getSelection().blockId != null) ||
        typing0 ||
        doc.querySelector('#menu:not([hidden]), #canvasMenu:not([hidden])'));
    });

    deps.wrap.addEventListener('pointermove', function(e){
      if (pinching()) return;
      if (!pointer.mode) return;
      var dx=e.clientX-pointer.startX, dy=e.clientY-pointer.startY;
      if (Math.abs(dx)>6||Math.abs(dy)>6) pointer.moved=true;

      if (pointer.mode==='maybe-link' && pointer.moved) {
        pointer.mode='linking';
        deps.ghost.style.display='block'; deps.ghost.textContent=pointer.ghostText;
      }
      if (pointer.mode==='linking') {
        // Float the ghost above a finger so it isn't hidden under the fingertip.
        deps.ghost.style.left=e.clientX+'px';
        deps.ghost.style.top=(pointer.touch ? e.clientY-TOUCH_DROP_Y_OFFSET : e.clientY)+'px';
        clearTargets(); clearCaret();
        var intent = linkIntentPoint(e);
        var drop = resolveDrop(intent.x, intent.y);
        if (drop.block) {
          if (dropInvalid(drop.block)) {
            drop.blockEl.classList.add('drop-invalid');
          } else {
            drop.blockEl.classList.add('drop-ok');
            showCaretAt(drop.blockEl, drop.idx);
          }
        }
        e.preventDefault();
        return;
      }
      if (pointer.mode==='drag-block' && pointer.block) {
        if (!pointer.snapshotted) { deps.snapshot(); pointer.snapshotted = true; }
        var z = deps.getZoom();
        pointer.block.x = deps.snap(pointer.origX+dx/z);
        pointer.block.y = deps.snap(pointer.origY+dy/z);
        if (deps.invalidateBlock) deps.invalidateBlock(pointer.block.id);
        var el = deps.blockEl(pointer.block.id);
        if (el){ el.style.left=pointer.block.x+'px'; el.style.top=pointer.block.y+'px'; }
        deps.drawLinks(deps.blocksMap());
        e.preventDefault();
        return;
      }
    });

    deps.wrap.addEventListener('pointerup', function(e){
      if (pinching()) { resetPointer(); return; }
      if (pointer.mode==='linking') {
        var ls = pointer.linkSrc, srcId = ls.sourceId;
        function newLink(){ return { type:'linked', sourceId: srcId, sourceTid: ls.sourceTid }; }
        clearTargets(); clearCaret();
        deps.ghost.style.display='none';

        var intent = linkIntentPoint(e);
        var drop = resolveDrop(intent.x, intent.y);
        if (drop.block) {
          var tb = drop.block;
          if (tb.id === srcId) { /* dropped back on its own source: no-op */ }
          else if (ls.sourceTid==null && deps.createsCycle(tb.id, srcId)) { flashCycle(); }
          else {
            // Always insert at the resolved gap, gluing with operators as needed.
            // An existing term is never overwritten.
            deps.snapshot();
            insertLinkBefore(tb, drop.idx, newLink());
            deps.setActiveBlockId(tb.id); deps.clearSelection(); deps.renderAll(); deps.save();
          }
        } else {
          var pt = toCanvas(intent.x, intent.y);
          deps.snapshot();
          var nb = deps.newBlock(deps.snap(pt.x), deps.snap(pt.y));
          nb.terms.push(newLink());
          deps.setActiveBlockId(nb.id); deps.clearSelection(); deps.renderAll(); deps.save();
        }
        resetPointer(); return;
      }

      if (pointer.mode==='maybe-link' && !pointer.moved) {
        if (pointer.pendingSelect) {
          deps.setSelection(pointer.pendingSelect);
          deps.setActiveBlockId(pointer.pendingSelect.blockId);
        } else {
          deps.setSelection({ blockId:pointer.linkSrc.sourceId, termIndex:null, kind:'result' });
          deps.setActiveBlockId(pointer.linkSrc.sourceId);
        }
        deps.renderAll();
        resetPointer(); return;
      }

      if (pointer.mode==='drag-block') {
        if (pointer.moved) deps.save();
        resetPointer(); return;
      }

      if (pointer.mode==='maybe-tap' && !pointer.moved) {
        // Commit any in-flight on-canvas label edit (its blur handler writes the
        // text) before we tear the block DOM down with renderAll. Outside taps
        // don't reliably blur a contenteditable on touch, so force it here.
        var ae = doc.activeElement;
        var wasNaming = ae && ae.classList && ae.classList.contains('cap');
        if (wasNaming) ae.blur();
        var activeBlockId = deps.getActiveBlockId();
        if (!pointer.hadFocus && !activeBlockId && !wasNaming) {
          var tapPt = toCanvas(e.clientX, e.clientY);
          deps.snapshot();
          var tapBlock = deps.newBlock(deps.snap(tapPt.x - 40), deps.snap(tapPt.y - 20));
          deps.setActiveBlockId(tapBlock.id); deps.clearSelection(); deps.renderAll(); deps.save();
          resetPointer(); return;
        }
        if (activeBlockId) {
          var fb = deps.byId(activeBlockId);
          if (fb && fb.terms.length===0) { deps.snapshot(); deps.removeBlock(fb.id); deps.save(); }
          // Leaving a block closes any still-open groups, matching '=' behaviour
          // so the on-screen expression reflects what the evaluator computed.
          else if (fb && Editing && Editing.unmatchedOpenParens(fb)) { deps.snapshot(); Editing.balanceParens(fb); deps.save(); }
        }
        deps.setActiveBlockId(null); deps.clearSelection(); deps.renderAll();
        resetPointer(); return;
      }
      resetPointer();
    });

    deps.canvas.addEventListener('pointerdown', function(e){
      var bEl = e.target.closest && e.target.closest('.block');
      var onTerm = e.target.closest && e.target.closest('.term, .result, .cap, .block-del');
      if (bEl && !onTerm) {
        // Long-press reveals the block's actions (the × delete control) by
        // making it active, rather than deleting outright — a stationary hold
        // should never destroy a block with no warning.
        lpTimer = setTimeout(function(){
          var blk = deps.byId(bEl.dataset.id);
          if (!blk) return;
          deps.setActiveBlockId(blk.id); deps.clearSelection(); deps.renderAll();
        }, 550);
      }
    });
    deps.canvas.addEventListener('pointermove', function(){ clearTimeout(lpTimer); });
    deps.canvas.addEventListener('pointerup', function(){ clearTimeout(lpTimer); });

    deps.wrap.addEventListener('wheel', function(e){
      if (!e.ctrlKey) return;
      e.preventDefault();
      var r = deps.wrap.getBoundingClientRect();
      deps.zoomAround(deps.getZoom() * (e.deltaY < 0 ? 1.1 : 1/1.1), e.clientX - r.left, e.clientY - r.top);
    }, { passive:false });

    deps.wrap.addEventListener('pointerdown', function(e){
      if (e.pointerType!=='touch') return;
      pinchPts[e.pointerId] = { x:e.clientX, y:e.clientY };
      if (pinchCount()===2) {
        var ids=Object.keys(pinchPts), a=pinchPts[ids[0]], b=pinchPts[ids[1]];
        pinch = { dist: Math.hypot(b.x-a.x, b.y-a.y), z: deps.getZoom() };
        resetPointer(); deps.ghost.style.display='none'; clearTargets(); clearCaret();
      }
    }, true);
    deps.wrap.addEventListener('pointermove', function(e){
      if (!pinchPts[e.pointerId]) return;
      pinchPts[e.pointerId] = { x:e.clientX, y:e.clientY };
      if (pinch && pinchCount()>=2) {
        e.preventDefault();
        var ids=Object.keys(pinchPts), a=pinchPts[ids[0]], b=pinchPts[ids[1]];
        var dist = Math.hypot(b.x-a.x, b.y-a.y);
        var r = deps.wrap.getBoundingClientRect();
        deps.zoomAround(pinch.z * (dist/pinch.dist), (a.x+b.x)/2 - r.left, (a.y+b.y)/2 - r.top);
      }
    }, true);
    function endPinch(e){ delete pinchPts[e.pointerId]; if (pinchCount()<2) pinch=null; }
    deps.wrap.addEventListener('pointerup', endPinch, true);
    deps.wrap.addEventListener('pointercancel', endPinch, true);

    doc.addEventListener('gesturestart', function(e){ e.preventDefault(); });
    var lastTouch=0;
    doc.addEventListener('touchend', function(e){
      if (e.target.closest && e.target.closest('.key, .tbtn, #padToggle, #toast button, .menu-item, .cv-btn, #canvasMenu')) { lastTouch=Date.now(); return; }
      var now=Date.now(); if(now-lastTouch<300) e.preventDefault(); lastTouch=now;
    }, {passive:false});
  }

  return { create: create };
});
