/* Canvas Calc - DOM rendering helpers.
 * Owns block rendering, link drawing, and the variables sidebar.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CanvasRenderer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LINK_PALETTE = ['#c9772f','#3f8f6b','#7b5ea7','#b8456b','#3d7bb0','#9a7b1f','#5a8f3d','#b0568f'];

  var SEP = ''; // signature field separator (won't appear in user data)

  function create(deps) {
    var doc = deps.document || document;
    var linkColorMap = {};
    // Keyed reconciliation state: a block's DOM element and a signature of every
    // input that affects how it renders. Unchanged blocks are left untouched.
    var blockEls = {};  // id -> element
    var blockSigs = {}; // id -> signature string
    var lastCanvasId = null; // reconcile is keyed by block id, which repeats across canvases

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
      if (b.terms.length) {
        var val = deps.resolve(b, map);
        parts.push('=', val == null ? '·' : val, linkColorMap[deps.srcKey(b.id, null)] || '');
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
      deps.hint.style.display = cur().blocks.length ? 'none' : 'block';
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

    // An editable caption that bonds a label to a value chip.
    function makeCaption(getText, setText) {
      var cap = doc.createElement('span');
      cap.className = 'cap';
      cap.contentEditable = 'true';
      var txt = getText() || '';
      cap.textContent = txt;
      if (txt) cap.title = txt; // full name on hover when clamped
      cap.addEventListener('pointerdown', function(e){
        e.stopPropagation();
        if (doc.activeElement !== cap) {
          e.preventDefault();
          cap.focus();
          var r = doc.createRange(); r.selectNodeContents(cap); r.collapse(false);
          var sn = window.getSelection(); sn.removeAllRanges(); sn.addRange(r);
        }
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
      del.addEventListener('click', function(e){ e.stopPropagation(); deps.confirmDeleteBlock(deps.byId(b.id)); });
      el.appendChild(del);

      var expr = doc.createElement('div');
      expr.className = 'expr';
      b.terms.forEach(function(t, idx){
        selection = sel();
        if (t.type==='operator') {
          var op = doc.createElement('span');
          op.className = 'term operator';
          if (selection.blockId===b.id && selection.termIndex===idx && selection.kind==='operator') op.className += ' sel';
          op.textContent = deps.opSym(t.value);
          op.dataset.idx = idx;
          expr.appendChild(op);
          return;
        }
        if (t.type==='paren') {
          var pp = doc.createElement('span');
          pp.className = 'term paren';
          pp.textContent = t.value;
          pp.dataset.idx = idx;
          expr.appendChild(pp);
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
        cell.appendChild(makeCaption(capGet, capSet));
        var span = doc.createElement('span');
        if (selection.blockId===b.id && selection.termIndex===idx) span.className = ' sel';
        if (t.type==='number') {
          span.className = 'term number' + span.className;
          span.textContent = deps.groupDisplay(t.value);
          var nkey = deps.srcKey(b.id, t.tid);
          if (linkColorMap[nkey]) span.style.boxShadow = 'inset 0 -2px 0 0 ' + linkColorMap[nkey];
        } else {
          span.className = 'term linked' + span.className;
          var lv = deps.linkedValue(t, map);
          span.textContent = (lv==null) ? '?' : deps.fmt(lv);
          span.dataset.linked = '1';
          var lkey = deps.srcKey(t.sourceId, t.sourceTid);
          var lc = linkColorMap[lkey];
          if (lc) { span.style.color = lc; span.style.background = lc + '22'; }
        }
        span.dataset.idx = idx;
        cell.appendChild(span);
        expr.appendChild(cell);
      });

      if (b.terms.length) {
        var val = deps.resolve(b, map);
        var eq = doc.createElement('span'); eq.className='eq'; eq.textContent='=';
        expr.appendChild(eq);

        var rcell = doc.createElement('span');
        rcell.className = 'cell';
        rcell.appendChild(makeCaption(
          function(){ return b.label; },
          function(v){ var nb=deps.byId(b.id); if(nb) nb.label = v; }
        ));
        var res = doc.createElement('span');
        selection = sel();
        res.className = 'result' + (val===null?' empty':'');
        if (selection.blockId===b.id && selection.kind==='result') res.className += ' sel';
        res.textContent = val===null ? '·' : deps.fmt(val);
        res.dataset.result = '1';
        res.dataset.id = b.id;
        var rkey = deps.srcKey(b.id, null);
        if (linkColorMap[rkey]) res.style.boxShadow = 'inset 0 -2px 0 0 ' + linkColorMap[rkey];
        rcell.appendChild(res);
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
            srcRes = srcEl.querySelector('.result');
          }
          var dstTerm = dstEl.querySelectorAll('.term')[idx];
          if (!srcRes||!dstTerm) return;
          var so = offsetIn(srcRes, srcEl), to = offsetIn(dstTerm, dstEl);
          var x1 = src.x + so.x + srcRes.offsetWidth/2;
          var y1 = src.y + so.y + srcRes.offsetHeight/2;
          var x2 = b.x + to.x + dstTerm.offsetWidth/2;
          var y2 = b.y + to.y + dstTerm.offsetHeight/2;
          var path = doc.createElementNS('http://www.w3.org/2000/svg','path');
          var dx = Math.abs(x2-x1)*0.4;
          path.setAttribute('d','M '+x1+' '+y1+' C '+(x1+dx)+' '+y1+' '+(x2-dx)+' '+y2+' '+x2+' '+y2);
          path.setAttribute('fill','none');
          path.setAttribute('stroke', linkColorMap[deps.srcKey(t.sourceId, t.sourceTid)] || 'var(--accent)');
          path.setAttribute('stroke-width','1.5');
          path.setAttribute('stroke-dasharray','3 3');
          path.setAttribute('opacity','0.75');
          deps.linkLayer.appendChild(path);
        });
      });
    }

    function collectVars() {
      var inputs = [], results = [];
      cur().blocks.forEach(function(b){
        b.terms.forEach(function(t, idx){
          if (t.type==='number') inputs.push({ bid:b.id, idx:idx, t:t });
        });
        if (b.terms.length) results.push(b);
      });
      return { inputs:inputs, results:results };
    }

    function sidebarOpen(){ return deps.sidebar.classList.contains('open'); }

    function layoutOverlays() {
      var h = deps.numpad.classList.contains('hidden') ? 0 : deps.numpad.offsetHeight;
      deps.sidebar.style.bottom = h + 'px';
      deps.zoomCtl.style.bottom = (h + 10) + 'px';
    }

    function syncSidebar() {
      if (!sidebarOpen()) return;
      if (deps.sidebar.contains(doc.activeElement)) refreshSidebarValues();
      else renderSidebar();
    }

    function scheduleSidebarRebuild() {
      setTimeout(function(){
        if (deps.sidebar.classList.contains('open') && !deps.sidebar.contains(doc.activeElement)) renderSidebar();
      }, 0);
    }

    function refreshSidebarValues() {
      var map = deps.blocksMap();
      deps.sidebarBody.querySelectorAll('.var-val[data-kind="result"]').forEach(function(el){
        var b = deps.byId(el.dataset.bid); if (b) el.textContent = deps.fmt(deps.resolve(b, map));
      });
      deps.sidebarBody.querySelectorAll('.var-def').forEach(function(el){
        var b = deps.byId(el.dataset.bid); if (b) el.textContent = '= ' + deps.blockDefinition(b, map);
      });
      deps.sidebarBody.querySelectorAll('.var-val[data-kind="input"]').forEach(function(el){
        if (el === doc.activeElement) return;
        var b = deps.byId(el.dataset.bid); if (!b) return;
        var t = b.terms[el.dataset.idx]; if (t) el.value = deps.groupDisplay(t.value);
      });
    }

    function renderSidebar() {
      var body = deps.sidebarBody;
      var map = deps.blocksMap();
      var v = collectVars();
      body.innerHTML = '';

      if (!v.inputs.length && !v.results.length) {
        var e = doc.createElement('div'); e.className = 'var-empty';
        e.textContent = 'No variables yet. Numbers and results show up here once you start a calculation — tap a name to label them.';
        body.appendChild(e);
        return;
      }

      function sec(label){ var d=doc.createElement('div'); d.className='var-sec'; d.textContent=label; return d; }

      if (v.inputs.length) {
        body.appendChild(sec('Inputs'));
        v.inputs.forEach(function(it){ body.appendChild(inputRow(it)); });
      }
      if (v.results.length) {
        body.appendChild(sec('Results'));
        v.results.forEach(function(b){ body.appendChild(resultRow(b, map)); });
      }
    }

    function inputRow(it) {
      var row = doc.createElement('div'); row.className = 'var-row';

      var name = doc.createElement('input');
      name.className = 'var-name'; name.value = it.t.label || '';
      name.placeholder = 'unnamed';
      var nameDirty = false;
      name.addEventListener('focus', function(){ nameDirty = false; });
      name.addEventListener('input', function(){
        var b = deps.byId(it.bid); if (!b) return;
        var t = b.terms[it.idx]; if (!t) return;
        if (!nameDirty) { deps.snapshot(); nameDirty = true; }
        t.label = name.value; deps.save(); renderAll();
      });
      name.addEventListener('blur', function(){ nameDirty = false; scheduleSidebarRebuild(); });

      var val = doc.createElement('input');
      val.className = 'var-val'; val.value = deps.groupDisplay(it.t.value);
      val.inputMode = 'decimal';
      val.dataset.bid = it.bid; val.dataset.idx = it.idx; val.dataset.kind = 'input';
      var valDirty = false;
      val.addEventListener('focus', function(){
        valDirty = false;
        var b = deps.byId(it.bid), t = b && b.terms[it.idx];
        if (t) val.value = t.value;
      });
      val.addEventListener('input', function(){
        var b = deps.byId(it.bid); if (!b) return;
        var t = b.terms[it.idx]; if (!t) return;
        if (!valDirty) { deps.snapshot(); valDirty = true; }
        t.value = val.value.split(deps.NUM_GROUP).join('').split(deps.NUM_DECIMAL).join('.');
        deps.save(); renderAll();
      });
      val.addEventListener('blur', function(){
        valDirty = false;
        var b = deps.byId(it.bid), t = b && b.terms[it.idx];
        if (t) val.value = deps.groupDisplay(t.value);
        scheduleSidebarRebuild();
      });

      row.appendChild(name); row.appendChild(val);
      return row;
    }

    function resultRow(b, map) {
      var row = doc.createElement('div'); row.className = 'var-row';

      var name = doc.createElement('input');
      name.className = 'var-name'; name.value = b.label || '';
      name.placeholder = 'unnamed';
      var nameDirty = false;
      name.addEventListener('focus', function(){ nameDirty = false; });
      name.addEventListener('input', function(){
        var nb = deps.byId(b.id); if (!nb) return;
        if (!nameDirty) { deps.snapshot(); nameDirty = true; }
        nb.label = name.value; deps.save(); renderAll();
      });
      name.addEventListener('blur', function(){ nameDirty = false; scheduleSidebarRebuild(); });

      var val = doc.createElement('span');
      val.className = 'var-val ro'; val.dataset.bid = b.id; val.dataset.kind = 'result';
      val.textContent = deps.fmt(deps.resolve(b, map));

      var def = doc.createElement('div');
      def.className = 'var-def'; def.dataset.bid = b.id;
      def.textContent = '= ' + deps.blockDefinition(b, map);

      row.appendChild(name); row.appendChild(val); row.appendChild(def);
      return row;
    }

    return {
      renderAll: renderAll,
      blockEl: blockElById,
      invalidateBlock: invalidateBlock,
      invalidateAll: invalidateAll,
      drawLinks: drawLinks,
      layoutOverlays: layoutOverlays,
      renderSidebar: renderSidebar,
      syncSidebar: syncSidebar,
      scheduleSidebarRebuild: scheduleSidebarRebuild
    };
  }

  return { create: create };
});
