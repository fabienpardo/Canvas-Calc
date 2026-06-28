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

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeSidebarNumber(raw, group, decimal) {
    if (raw == null) return null;
    group = group == null ? ',' : String(group);
    decimal = decimal == null ? '.' : String(decimal);
    var value = String(raw).trim();
    if (!value) return null;

    var g = group ? escapeRegex(group) : null;
    var d = decimal ? escapeRegex(decimal) : '\\.';
    var plainInt = '\\d+';
    var groupedInt = g ? '\\d{1,3}(?:' + g + '\\d{3})+' : plainInt;
    var intPart = '(?:' + plainInt + '|' + groupedInt + ')';
    var pattern = new RegExp('^-?(?:(?:' + intPart + ')(?:' + d + '\\d*)?|' + d + '\\d+)$');
    if (!pattern.test(value)) return null;

    var normalized = group ? value.split(group).join('') : value;
    if (decimal !== '.') normalized = normalized.split(decimal).join('.');
    if (normalized.charAt(0) === '.') normalized = '0' + normalized;
    if (normalized.slice(0, 2) === '-.') normalized = '-0' + normalized.slice(1);
    return normalized;
  }

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

    function hasUnknownLinkedValue(b, map) {
      for (var i = 0; i < b.terms.length; i++) {
        var t = b.terms[i];
        if (t.type === 'linked' && deps.linkedValue(t, map) == null) return true;
      }
      return false;
    }

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
      if (deps.hasResultSlot(b.terms)) {
        if (missIdx >= 0) {
          parts.push('=?'); // malformed: missing operator
        } else {
          var val = deps.resolve(b, map);
          parts.push('=', val == null ? (hasUnknownLinkedValue(b, map) ? '?' : '·') : val,
            linkColorMap[deps.srcKey(b.id, null)] || '');
        }
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

    function appendSelectionCue(parent) {
      var cue = doc.createElement('span');
      cue.className = 'selection-caret';
      cue.setAttribute('aria-hidden', 'true');
      cue.title = 'Next input inserts here';
      parent.appendChild(cue);
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
          gap.title = gapSelected ? 'Selected missing operator — press an operator to fill it' : 'Operator missing — tap to add one';
          makeSelectable(gap, gap.title, b.id, missIdx, 'missing-op');
          expr.appendChild(gap);
          if (gapSelected) appendSelectionCue(expr);
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
          if (opSelected) appendSelectionCue(expr);
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
          if (parenSelected) appendSelectionCue(expr);
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
          if (linkColorMap[nkey]) span.style.boxShadow = 'inset 0 -2px 0 0 ' + linkColorMap[nkey];
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
            span.style.background = lc + '1f';
            span.style.boxShadow = 'inset 0 0 0 1px ' + lc + '59';
          }
        }
        span.dataset.idx = idx;
        makeSelectable(span, span.title, b.id, idx, t.type==='linked' ? 'linked' : 'number');
        cell.appendChild(span);
        expr.appendChild(cell);
        if (termSelected) appendSelectionCue(expr);
      });

      // Caret at the live input position when free-typing into the active block
      // (no specific term tapped), so the eye lands on the operand being entered
      // rather than the bright result chip that follows.
      if (deps.getActiveBlockId()===b.id && sel().blockId !== b.id && b.terms.length) {
        var caret = doc.createElement('span');
        caret.className = 'expr-caret';
        expr.appendChild(caret);
      }

      if (deps.hasResultSlot(b.terms)) {
        var malformed = missIdx >= 0;
        var unknownLinked = !malformed && hasUnknownLinkedValue(b, map);
        var val = (malformed || unknownLinked) ? null : deps.resolve(b, map);
        var eq = doc.createElement('span'); eq.className='eq'; eq.textContent='=';
        expr.appendChild(eq);

        var rcell = doc.createElement('span');
        rcell.className = 'cell';
        rcell.appendChild(makeCaption(
          function(){ return b.label; },
          function(v){ var nb=deps.byId(b.id); if(nb) nb.label = v; },
          'Name result'
        ));
        var res = doc.createElement('span');
        selection = sel();
        if (malformed || unknownLinked) {
          // Missing an operator: show "?" (not a draggable/linkable result) so a
          // half-finished expression, or one depending on it, never reads as a real answer.
          res.className = 'result pending';
          res.textContent = '?';
        } else {
          res.className = 'result' + (val===null?' empty':'');
          if (selection.blockId===b.id && selection.kind==='result') res.className += ' sel';
          res.textContent = val===null ? '·' : deps.fmt(val);
          res.dataset.result = '1';
          res.dataset.id = b.id;
          res.title = selection.blockId===b.id && selection.kind==='result' ? 'Selected result' : 'Select or drag this result';
          makeSelectable(res, res.title, b.id, null, 'result');
          var rkey = deps.srcKey(b.id, null);
          if (linkColorMap[rkey]) res.style.boxShadow = 'inset 0 -2px 0 0 ' + linkColorMap[rkey];
        }
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
          path.setAttribute('stroke-width','2');
          path.setAttribute('stroke-linecap','round');
          path.setAttribute('stroke-dasharray','0.1 6');
          path.setAttribute('opacity','0.8');
          deps.linkLayer.appendChild(path);
          // Solid endpoint dots anchor the dotted link to its source and target.
          [[x1,y1,2.5],[x2,y2,3]].forEach(function(p){
            var dot = doc.createElementNS(svgNS,'circle');
            dot.setAttribute('cx', p[0]); dot.setAttribute('cy', p[1]); dot.setAttribute('r', p[2]);
            dot.setAttribute('fill', col);
            deps.linkLayer.appendChild(dot);
          });
        });
      });
    }

    // One entry per block (in canvas order): its number operands plus whether
    // the block currently evaluates to a result. Empty drafts are skipped.
    function collectGroups() {
      var groups = [];
      cur().blocks.forEach(function(b){
        var inputs = [];
        b.terms.forEach(function(t, idx){
          if (t.type==='number') inputs.push({ bid:b.id, idx:idx, t:t });
        });
        var isResult = deps.isComplete(b.terms) && deps.missingOperatorIndex(b.terms) < 0;
        if (!inputs.length && !isResult) return;
        groups.push({ block:b, inputs:inputs, isResult:isResult });
      });
      return groups;
    }

    function sidebarOpen(){ return deps.sidebar.classList.contains('open'); }

    function layoutOverlays() {
      var win = doc.defaultView || window;
      var wide = win.matchMedia && win.matchMedia('(min-width: 760px)').matches;
      var h = (!wide && !deps.numpad.classList.contains('hidden')) ? deps.numpad.offsetHeight : 0;
      deps.sidebar.style.bottom = h + 'px';
      deps.zoomCtl.style.bottom = (wide ? 18 : h + 12) + 'px';
      // The empty-canvas hint is a band over the visible canvas (toolbar to
      // keypad), so its contents centre in the space the user actually sees.
      if (deps.hint) deps.hint.style.bottom = h + 'px';
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
      var groups = collectGroups();
      body.innerHTML = '';

      if (!groups.length) {
        var e = doc.createElement('div'); e.className = 'var-empty';
        e.textContent = 'No variables yet. Numbers and results show up here once you start a calculation — tap a name to label them.';
        body.appendChild(e);
        return;
      }

      // Each block becomes a group: its result (or a pending marker) as the
      // heading, with the block's number operands nested below it.
      groups.forEach(function(g){
        var sec = doc.createElement('div'); sec.className = 'var-group';
        sec.appendChild(groupHead(g.block, g.isResult, map));
        g.inputs.forEach(function(it){ sec.appendChild(inputRow(it)); });
        body.appendChild(sec);
      });
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
        var nextValue = normalizeSidebarNumber(val.value, deps.NUM_GROUP, deps.NUM_DECIMAL);
        if (nextValue == null) {
          val.classList.add('invalid');
          val.setAttribute('aria-invalid', 'true');
          return;
        }
        val.classList.remove('invalid');
        val.removeAttribute('aria-invalid');
        if (!valDirty) { deps.snapshot(); valDirty = true; }
        t.value = nextValue;
        deps.save(); renderAll();
      });
      val.addEventListener('blur', function(){
        valDirty = false;
        val.classList.remove('invalid');
        val.removeAttribute('aria-invalid');
        var b = deps.byId(it.bid), t = b && b.terms[it.idx];
        if (t) val.value = deps.groupDisplay(t.value);
        scheduleSidebarRebuild();
      });

      row.appendChild(name); row.appendChild(val);
      return row;
    }

    // The heading for a block's group: an editable block name, plus either its
    // computed result + definition (when complete) or a muted pending marker.
    function groupHead(b, isResult, map) {
      var row = doc.createElement('div'); row.className = 'var-row var-head';

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
      row.appendChild(name);

      if (isResult) {
        var val = doc.createElement('span');
        val.className = 'var-val ro'; val.dataset.bid = b.id; val.dataset.kind = 'result';
        val.textContent = deps.fmt(deps.resolve(b, map));
        row.appendChild(val);

        var def = doc.createElement('div');
        def.className = 'var-def'; def.dataset.bid = b.id;
        def.textContent = '= ' + deps.blockDefinition(b, map);
        row.appendChild(def);
      } else {
        var pend = doc.createElement('span');
        pend.className = 'var-val ro var-pending';
        pend.textContent = '…'; // … : block isn't a complete calculation yet
        row.appendChild(pend);
      }

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

  return { create: create, normalizeSidebarNumber: normalizeSidebarNumber };
});
