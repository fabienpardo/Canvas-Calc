/* Canvas Calc - pointer, drag/link, and touch interaction wiring. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CanvasInteractions = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(deps) {
    var doc = deps.document || document;
    var pointer = { mode:null, startX:0, startY:0, block:null, moved:false, linkSrc:null, pendingSelect:null };
    var pinchPts = {}, pinch = null;
    var lpTimer = null;

    function pinchCount(){ return Object.keys(pinchPts).length; }
    function pinching(){ return !!pinch; }

    function resetPointer() { pointer = { mode:null }; }

    function clearTargets(){
      deps.canvas.querySelectorAll('.slot-target').forEach(function(e){e.classList.remove('slot-target');});
    }

    function toCanvas(clientX, clientY){
      var r = deps.canvas.getBoundingClientRect();
      return { x: (clientX - r.left)/deps.getZoom(), y: (clientY - r.top)/deps.getZoom() };
    }

    function flashCycle(){
      deps.confirmDialog('Can\u2019t link these \u2014 it would create a loop where a result depends on itself.', function(){}, 'Got it');
      doc.getElementById('toastRow').firstChild.style.display='none';
    }

    deps.wrap.addEventListener('pointerdown', function(e){
      if (pinching()) return;
      var target = e.target;
      if (target.closest && target.closest('#zoomCtl')) return;

      var resEl = target.closest && target.closest('.result');
      if (resEl && !resEl.classList.contains('empty')) {
        pointer.mode='maybe-link'; pointer.startX=e.clientX; pointer.startY=e.clientY;
        pointer.linkSrc = { sourceId: resEl.dataset.id, sourceTid: null }; pointer.moved=false;
        pointer.ghostText = resEl.textContent; pointer.pendingSelect = null;
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

      if (target.closest && target.closest('.cap')) return;

      var bEl = target.closest && target.closest('.block');
      if (bEl) {
        pointer.mode='drag-block'; pointer.block=deps.byId(bEl.dataset.id);
        pointer.startX=e.clientX; pointer.startY=e.clientY;
        pointer.origX=pointer.block.x; pointer.origY=pointer.block.y;
        pointer.moved=false; pointer.snapshotted=false;
        deps.setSelection({ blockId:pointer.block.id, termIndex:null, kind:'result' });
        deps.canvas.querySelectorAll('.selected, .sel').forEach(function(x){ x.classList.remove('selected','sel'); });
        bEl.classList.add('selected');
        var rc = bEl.querySelector('.result'); if (rc) rc.classList.add('sel');
        bEl.setPointerCapture && bEl.setPointerCapture(e.pointerId);
        return;
      }

      pointer.mode='maybe-tap';
      pointer.startX=e.clientX; pointer.startY=e.clientY; pointer.moved=false;
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
        deps.ghost.style.left=e.clientX+'px'; deps.ghost.style.top=e.clientY+'px';
        clearTargets();
        var under = doc.elementFromPoint(e.clientX, e.clientY);
        var slot = under && under.closest && under.closest('.term.number');
        var bUnder = under && under.closest && under.closest('.block');
        if (slot) slot.classList.add('slot-target');
        else if (bUnder && bUnder.dataset.id!==pointer.linkSrc.sourceId) bUnder.classList.add('slot-target');
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
        var under = doc.elementFromPoint(e.clientX, e.clientY);
        var slot = under && under.closest && under.closest('.term.number');
        var bUnder = under && under.closest && under.closest('.block');
        var ls = pointer.linkSrc, srcId = ls.sourceId;
        function cyc(targetId){ return ls.sourceTid==null && deps.createsCycle(targetId, srcId); }
        function newLink(){ return { type:'linked', sourceId: srcId, sourceTid: ls.sourceTid }; }
        clearTargets();
        deps.ghost.style.display='none';

        if (slot && bUnder && bUnder.dataset.id!==srcId) {
          var tb = deps.byId(bUnder.dataset.id);
          var ti = parseInt(slot.dataset.idx,10);
          if (tb && !cyc(tb.id)) {
            deps.snapshot();
            tb.terms[ti] = newLink();
            deps.setActiveBlockId(tb.id); deps.clearSelection(); deps.renderAll(); deps.save();
          } else { flashCycle(); }
        } else if (bUnder && bUnder.dataset.id!==srcId) {
          var tb2 = deps.byId(bUnder.dataset.id);
          if (tb2 && !cyc(tb2.id)) {
            deps.snapshot();
            var lastT = tb2.terms[tb2.terms.length-1];
            if (lastT && lastT.type!=='operator') tb2.terms.push({type:'operator', value:'+'});
            tb2.terms.push(newLink());
            deps.setActiveBlockId(tb2.id); deps.clearSelection(); deps.renderAll(); deps.save();
          } else { flashCycle(); }
        } else if (!bUnder) {
          var pt = toCanvas(e.clientX, e.clientY);
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
        var activeBlockId = deps.getActiveBlockId();
        if (activeBlockId) {
          var fb = deps.byId(activeBlockId);
          if (fb && fb.terms.length===0) { deps.snapshot(); deps.removeBlock(fb.id); deps.save(); }
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
        lpTimer = setTimeout(function(){
          deps.confirmDeleteBlock(deps.byId(bEl.dataset.id));
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
        resetPointer(); deps.ghost.style.display='none'; clearTargets();
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
