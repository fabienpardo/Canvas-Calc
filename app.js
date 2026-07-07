/* Canvas Calc - application controller and bootstrap.
 * Wires the extracted modules (engine/state/render/interactions/canvases/
 * editing/input/history) to the DOM, owns shared view state, and handles
 * persistence, viewport/zoom, toolbar, menu, and keyboard input.
 */
(function () {
  "use strict";

  // ---------- Pure engine (see engine.js) ----------
  var E = window.CanvasEngine;
  var linkedValue = E.linkedValue, linkedSource = E.linkedSource, resolve = E.resolve,
      fmt = E.fmt, groupDisplay = E.groupDisplay, opSym = E.opSym,
      blockDefinition = E.blockDefinition, parseExpression = E.parseExpression,
      NUM_GROUP = E.NUM_GROUP, NUM_DECIMAL = E.NUM_DECIMAL;
  var State = window.CanvasState;
  var Editing = window.CanvasEditing;
  // App wrapper injects the current block map into the pure cycle check.
  function createsCycle(targetId, srcId) { return E.createsCycle(targetId, srcId, blocksMap()); }

  // ---------- State ----------
  // Multiple canvases ("sheets"). Each owns its blocks + id counters + zoom.
  // App-global settings (fontSize, showGrid) live at the top level.
  var state = State.normalizeState(null);
  var zoom = 1; // current view scale (mirror of cur().zoom)
  var ZOOM_MIN = 0.4, ZOOM_MAX = 2.5;
  // Selection + active-block state and the snapshot/render/save policy live in
  // the store (see store.js). snapshot/renderAll/save are hoisted below.
  var store = CanvasStore.create({ snapshot: snapshot, renderAll: renderAll, save: save });
  var SNAP = 20;
  var BLOCK_GAP = 36;
  var FONT_SIZES = [18, 22, 28];

  var canvas = document.getElementById('canvas');
  var wrap = document.getElementById('canvasWrap');
  var linkLayer = document.getElementById('linkLayer');
  var hint = document.getElementById('hint');

  // The active canvas.
  function cur() {
    for (var i=0;i<state.canvases.length;i++) if (state.canvases[i].id===state.activeCanvasId) return state.canvases[i];
    return state.canvases[0];
  }

  // ---------- Persistence ----------
  var saveTimer = null;
  var savePending = false;
  var saveFailed = false;
  var saveWarning = document.getElementById('saveWarning');
  function setSaveFailed(failed) {
    if (saveFailed === failed) return;
    saveFailed = failed;
    if (saveWarning) saveWarning.style.display = failed ? 'block' : 'none';
  }
  function persistNow() {
    try {
      localStorage.setItem('canvascalc.v1', JSON.stringify(state));
      setSaveFailed(false);
    } catch (e) {
      setSaveFailed(true);
    }
  }
  function save() {
    savePending = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      savePending = false;
      persistNow();
    }, 400);
  }
  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!savePending) return;
    savePending = false;
    persistNow();
  }
  function load() {
    var saved = null;
    try {
      var raw = localStorage.getItem('canvascalc.v1');
      if (raw) saved = JSON.parse(raw);
    } catch (e) {}
    state = State.normalizeState(saved || state);
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cur().zoom));
  }
  window.addEventListener('pagehide', flushSave);
  window.addEventListener('beforeunload', flushSave);
  document.addEventListener('visibilitychange', function(){
    if (document.visibilityState === 'hidden') flushSave();
  });

  // html/body normally disable native pinch-zoom (touch-action: none) so a
  // two-finger gesture on the canvas drives our own zoom instead of the
  // browser's. But that also blocks pinch-zoom while the iOS keyboard is up
  // for a real text field (canvas rename, variable name/value), leaving no
  // way to zoom out and see the full app. Lift the restriction for the
  // duration of that focus.
  function isTextEntry(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') return !el.type || el.type === 'text' || el.type === 'decimal' || /^(text|search|email|url|tel|number|decimal)$/.test(el.type);
    return el.isContentEditable === true;
  }
  document.addEventListener('focusin', function (e) {
    if (isTextEntry(e.target)) document.documentElement.classList.add('text-editing');
  });
  document.addEventListener('focusout', function (e) {
    if (isTextEntry(e.target)) document.documentElement.classList.remove('text-editing');
  });

  // ---------- History (per canvas) — see history.js ----------
  var historyCtl = CanvasHistory.create({
    cur: cur,
    getActiveCanvasId: function(){ return state.activeCanvasId; },
    clearSelection: store.clearSelection,
    setActiveBlockId: store.setActiveBlockId,
    renderAll: renderAll,
    save: save,
    afterRestore: function(){ applyCanvasName(); }, // keep the toolbar title in sync after undo/redo
    undoBtn: document.getElementById('undoBtn'),
    redoBtn: document.getElementById('redoBtn')
  });
  function snapshot(){ historyCtl.snapshot(); }
  function undo(){ historyCtl.undo(); }
  function redo(){ historyCtl.redo(); }
  function updateUndoRedo(){ historyCtl.updateButtons(); }

  // ---------- Model helpers ----------
  function byId(id) { return State.byId(cur(), id); }
  function blocksMap() { return State.blocksMap(cur()); }
  // Delegates to the renderer's id->element map (populated each render),
  // avoiding a linear DOM scan on every lookup.
  function blockEl(id) { return renderer.blockEl(id); }

  function newBlock(x, y) {
    var c = cur();
    var b = { id: 'b' + (c.nextId++), x: x, y: y, label: '', terms: [] };
    c.blocks.push(b);
    return b;
  }
  function newNumber(value) { return { type:'number', value:value, tid:'t'+(cur().nextTid++) }; }

  // ---------- Link colors ----------
  function srcKey(sourceId, sourceTid) { return sourceId + '|' + (sourceTid==null ? '@result' : sourceTid); }
  var renderer = CanvasRenderer.create({
    document: document,
    canvas: canvas,
    linkLayer: linkLayer,
    hint: hint,
    sidebar: document.getElementById('sidebar'),
    sidebarBody: document.getElementById('sidebarBody'),
    numpad: document.getElementById('numpad'),
    zoomCtl: document.getElementById('zoomCtl'),
    linkTip: document.getElementById('linkTip'),
    cur: cur,
    getSelection: store.getSelection,
    setSelection: store.setSelection,
    getActiveBlockId: store.getActiveBlockId,
    setActiveBlockId: store.setActiveBlockId,
    getFontSize: function(){ return state.fontSize; },
    blocksMap: blocksMap,
    byId: byId,
    blockEl: blockEl,
    snapshot: snapshot,
    save: save,
    updateUndoRedo: updateUndoRedo,
    positionAddBtn: positionAddBtn,
    updateViewport: updateViewport,
    deleteBlock: deleteBlock,
    fillMissingOp: fillMissingOp,
    linkedSource: linkedSource,
    linkedValue: linkedValue,
    resolve: resolve,
    isComplete: E.isComplete,
    hasResultSlot: E.hasResultSlot,
    missingOperatorIndex: E.missingOperatorIndex,
    diagnose: E.diagnose,
    fmt: fmt,
    groupDisplay: groupDisplay,
    opSym: opSym,
    blockDefinition: blockDefinition,
    srcKey: srcKey,
    NUM_GROUP: NUM_GROUP,
    NUM_DECIMAL: NUM_DECIMAL
  });
  function renderAll(){
    renderer.renderAll();
    maybeShowLinkTip();
    followActiveInput();
  }
  function invalidateBlock(id){ renderer.invalidateBlock(id); }

  function followActiveInput() {
    var activeId = store.getActiveBlockId();
    if (!activeId) return;
    var block = blockEl(activeId);
    if (!block) return;
    var marker = block.querySelector('.expr-caret') || block.querySelector('.selection-caret') || block.querySelector('.term.has-caret');
    if (!marker) return;
    window.requestAnimationFrame(function(){
      if (!store.getActiveBlockId()) return;
      var r = marker.getBoundingClientRect();
      if (!r.width && !r.height) return;
      var wrapR = wrap.getBoundingClientRect();
      var pad = document.getElementById('numpad');
      var padH = (pad && !pad.classList.contains('hidden')) ? pad.offsetHeight : 0;
      var vv = window.visualViewport;
      var viewportBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      var visible = {
        left: wrapR.left + 18,
        right: wrapR.right - 18,
        top: wrapR.top + 18,
        bottom: Math.min(wrapR.bottom, viewportBottom - padH) - 18
      };
      var dx = 0, dy = 0;
      if (r.right > visible.right) dx = r.right - visible.right;
      else if (r.left < visible.left) dx = r.left - visible.left;
      if (r.bottom > visible.bottom) dy = r.bottom - visible.bottom;
      else if (r.top < visible.top) dy = r.top - visible.top;
      if (dx) wrap.scrollLeft += dx;
      if (dy) wrap.scrollTop += dy;
    });
  }

  // Fill a missing-operator gap from the inline picker (mirrors the keypad path
  // in input.js so both routes share one model mutation).
  function fillMissingOp(blockId, idx, op) {
    var b = byId(blockId); if (!b) return;
    store.commit(function () {
      store.setSelection(Editing.insertOperatorAtGap(b, idx, op));
      store.setActiveBlockId(b.id);
    });
  }

  // One-time nudge teaching the core gesture: shown the first time the canvas
  // has a real result, retired for good once the user makes a link (or dismisses).
  var LINK_TIP_KEY = 'cc_link_tip_seen';
  var linkTipDone = false;
  try { linkTipDone = localStorage.getItem(LINK_TIP_KEY) === '1'; } catch (e) {}
  function retireLinkTip() {
    linkTipDone = true;
    var tip = document.getElementById('linkTip');
    if (tip) tip.hidden = true;
    try { localStorage.setItem(LINK_TIP_KEY, '1'); } catch (e) {}
  }
  function maybeShowLinkTip() {
    if (linkTipDone) return;
    var blocks = cur().blocks, hasResult = false, hasLink = false;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      for (var j = 0; j < b.terms.length; j++) if (b.terms[j].type === 'linked') hasLink = true;
      if (!hasResult && E.hasResultSlot(b.terms) && E.missingOperatorIndex(b.terms) < 0) hasResult = true;
    }
    if (hasLink) { retireLinkTip(); return; } // they already get it
    var tip = document.getElementById('linkTip');
    if (tip && hasResult) tip.hidden = false;
  }
  function drawLinks(map){ renderer.drawLinks(map); }
  function layoutOverlays(){ renderer.layoutOverlays(); }
  function renderSidebar(){ renderer.renderSidebar(); }

  // ---------- Viewport: dynamic size + zoom ----------
  function updateViewport() {
    var pad = 600, maxR = 0, maxB = 0;
    cur().blocks.forEach(function(b){
      var el = blockEl(b.id);
      maxR = Math.max(maxR, b.x + (el ? el.offsetWidth : 120));
      maxB = Math.max(maxB, b.y + (el ? el.offsetHeight : 60));
    });
    var ab = document.getElementById('addBtn');
    if (ab && ab.style.display !== 'none') {
      maxR = Math.max(maxR, (parseInt(ab.style.left,10)||0) + 60);
      maxB = Math.max(maxB, (parseInt(ab.style.top,10)||0) + 60);
    }
    // Always keep the canvas larger than the viewport so there's room to pan/scroll
    // in both directions, and grow it to fit content.
    var viewW = wrap.clientWidth / zoom, viewH = wrap.clientHeight / zoom;
    var W = Math.max(maxR + pad, viewW + pad), H = Math.max(maxB + pad, viewH + pad);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    canvas.style.transform = 'scale(' + zoom + ')';
    var sizer = document.getElementById('canvasSizer');
    sizer.style.width = (W * zoom) + 'px';
    sizer.style.height = (H * zoom) + 'px';
  }

  function updateZoomLabel() {
    document.getElementById('zoomLevel').textContent = Math.round(zoom*100) + '%';
  }

  function clampZoom(value) {
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
  }

  // Set zoom while keeping the logical point under viewport coord (vx,vy) fixed.
  function zoomAround(newZoom, vx, vy) {
    newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
    if (newZoom === zoom) return;
    var lx = (wrap.scrollLeft + vx) / zoom;
    var ly = (wrap.scrollTop + vy) / zoom;
    zoom = newZoom; cur().zoom = zoom;
    updateViewport(); updateZoomLabel();
    wrap.scrollLeft = lx * zoom - vx;
    wrap.scrollTop = ly * zoom - vy;
    save();
  }
  function zoomByCenter(factor) {
    zoomAround(zoom * factor, wrap.clientWidth/2, wrap.clientHeight/2);
  }
  function resetZoom() {
    zoomAround(1, wrap.clientWidth/2, wrap.clientHeight/2);
  }

  // The visually lowest block (greatest bottom edge) — where a new calc goes next.
  function lowestBlock() {
    var best = null, bestBottom = -Infinity;
    cur().blocks.forEach(function(b){
      var el = blockEl(b.id);
      var bottom = b.y + (el ? el.offsetHeight : 40);
      if (bottom > bestBottom) { bestBottom = bottom; best = b; }
    });
    return best;
  }
  // Position just below a block (or the default start spot when there are none).
  function slotBelow(b) {
    if (!b) return { x: 40, y: 30 };
    var el = blockEl(b.id);
    return { x: b.x, y: b.y + (el ? el.offsetHeight : 40) + BLOCK_GAP };
  }

  // The "+ add" button sits below the lowest block, and hides while editing.
  function positionAddBtn() {
    var btn = document.getElementById('addBtn');
    // Hidden while editing, and on an empty canvas (the hint card's "+" adds the
    // first block there instead of a redundant button floating top-left).
    if (store.getActiveBlockId() || !cur().blocks.length) { btn.style.display = 'none'; return; }
    btn.style.display = 'flex';
    var pt = slotBelow(lowestBlock());
    btn.style.left = pt.x + 'px';
    btn.style.top = pt.y + 'px';
  }

  // ---------- Input handling ----------
  function snap(v){ return Math.round(v/SNAP)*SNAP; }
  // Where the next new block goes (below the lowest block). Used by the input controller.
  function nextSlot(){ return slotBelow(lowestBlock()); }

  function clearCanvas() {
    if (!cur().blocks.length) return;
    confirmDialog('Clear the canvas? This removes every block on it.', function(){
      store.commit(function(){ cur().blocks=[]; store.setActiveBlockId(null); store.clearSelection(); });
    }, 'Clear', true);
  }

  // ---------- Canvases (sheets) ----------
  var canvasManager = CanvasCanvases.create({
    document: document,
    State: State,
    wrap: wrap,
    getState: function(){ return state; },
    cur: cur,
    clampZoom: clampZoom,
    setZoom: function(nextZoom){ zoom = nextZoom; },
    clearSelection: store.clearSelection,
    setActiveBlockId: store.setActiveBlockId,
    updateZoomLabel: updateZoomLabel,
    renderAll: renderAll,
    layoutOverlays: layoutOverlays,
    save: save,
    snapshot: snapshot,
    deleteUndoStack: function(id){ historyCtl.deleteStack(id); },
    confirmDialog: confirmDialog
  });
  function applyCanvasName(){ canvasManager.applyCanvasName(); }

  // ---------- Input controller (see input.js) ----------
  // Created below, after removeBlock / deleteBlock / clearCanvas are defined.
  var inputCtl = null;

  function removeBlock(id) {
    // Freeze any term that links to this block into a constant of its last value,
    // so dependent expressions stay valid (no dangling "+ 3") instead of being filtered out.
    var map = blocksMap(); // still includes the block being removed
    cur().blocks.forEach(function(b){
      if (b.id===id) return;
      b.terms = b.terms.map(function(t){
        if (t.type==='linked' && t.sourceId===id) {
          var v = linkedValue(t, map);
          var rv = (v==null || isNaN(v)) ? 0 : Math.round(v*1e10)/1e10;
          return newNumber(String(rv));
        }
        return t;
      });
    });
    cur().blocks = cur().blocks.filter(function(b){ return b.id!==id; });
    if (store.getActiveBlockId()===id) store.setActiveBlockId(null);
  }

  // Freeze every term-link that points at one specific number term (sourceId +
  // tid) into a constant of the given value. Used when that number term is about
  // to be deleted, so its dependents stay valid numbers instead of dangling "?".
  function freezeTermDependents(blockId, tid, value) {
    var v = parseFloat(value);
    var rv = isNaN(v) ? 0 : Math.round(v * 1e10) / 1e10;
    cur().blocks.forEach(function(b){
      b.terms = b.terms.map(function(t){
        if (t.type==='linked' && t.sourceId===blockId && t.sourceTid===tid) return newNumber(String(rv));
        return t;
      });
    });
  }

  // How many linked terms in other blocks point at this block. Deleting it
  // freezes each into a constant, so warn before a non-obvious data change.
  function dependentLinkCount(id) {
    var n = 0;
    cur().blocks.forEach(function(b){
      if (b.id===id) return;
      b.terms.forEach(function(t){ if (t.type==='linked' && t.sourceId===id) n++; });
    });
    return n;
  }

  function deleteBlock(b) {
    if (!b) return;
    function go(){ store.commit(function(){ removeBlock(b.id); store.clearSelection(); }); }
    var deps = dependentLinkCount(b.id);
    if (deps > 0) {
      confirmDialog(
        'Deleting this freezes ' + deps + ' linked value' + (deps===1?'':'s') +
          ' into fixed numbers.',
        go, 'Delete', true);
      return;
    }
    go();
  }

  // ---------- Toast / dialog ----------
  function confirmDialog(msg, onYes, yesLabel, danger) {
    var t=document.getElementById('toast'), sc=document.getElementById('scrim');
    var prevFocus = document.activeElement;
    document.getElementById('toastMsg').textContent = msg;
    var row=document.getElementById('toastRow'); row.innerHTML='';
    var cancel=document.createElement('button'); cancel.textContent='Cancel';
    var ok=document.createElement('button'); ok.textContent=yesLabel||'OK'; if(danger) ok.className='danger';
    function close(){
      t.style.display='none'; sc.style.display='none'; document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    }
    function onKey(e){
      if(e.key==='Escape'){ e.preventDefault(); close(); return; }
      if(e.key==='Tab'){
        var buttons = [cancel, ok];
        var curIdx = buttons.indexOf(document.activeElement);
        if (curIdx < 0) return;
        e.preventDefault();
        buttons[(curIdx + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
      }
    }
    cancel.onclick=function(){ close(); };
    ok.onclick=function(){ close(); onYes(); };
    row.appendChild(cancel); row.appendChild(ok);
    t.style.display='block'; sc.style.display='block';
    document.addEventListener('keydown', onKey, true);
    cancel.focus();
  }
  function showNotice(msg) {
    var t=document.getElementById('toast'), sc=document.getElementById('scrim');
    var prevFocus = document.activeElement;
    document.getElementById('toastMsg').textContent = msg;
    var row=document.getElementById('toastRow'); row.innerHTML='';
    var ok=document.createElement('button'); ok.textContent='OK';
    function close(){
      t.style.display='none'; sc.style.display='none'; document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    }
    function onKey(e){
      if(e.key==='Escape'){ e.preventDefault(); close(); return; }
      if(e.key==='Tab' && document.activeElement === ok){ e.preventDefault(); ok.focus(); }
    }
    ok.onclick=function(){ close(); };
    row.appendChild(ok);
    t.style.display='block'; sc.style.display='block';
    document.addEventListener('keydown', onKey, true);
    ok.focus();
  }

  // Live status for the keyboard link flow: a visible pill that is also an
  // aria-live region, so both sighted keyboard users and screen readers learn
  // what to do next. Empty message hides it.
  function setLinkStatus(msg) {
    var el = document.getElementById('linkStatus');
    if (!el) return;
    if (msg) { el.textContent = msg; el.hidden = false; }
    else { el.textContent = ''; el.hidden = true; }
  }

  // One-time heads-up that ± on a linked number edits its shared source, since
  // that ripples to every place the value is used (intentional, but surprising).
  function notifyLinkedNeg() {
    try { if (localStorage.getItem('canvascalc.linkedNegHint')) return; } catch (e) {}
    try { localStorage.setItem('canvascalc.linkedNegHint', '1'); } catch (e) {}
    showNotice('± on a linked number changes its source value everywhere it’s used.');
  }

  inputCtl = CanvasInput.create({
    Editing: Editing,
    cur: cur,
    byId: byId,
    blocksMap: blocksMap,
    newBlock: newBlock,
    newNumber: newNumber,
    snap: snap,
    nextSlot: nextSlot,
    slotBelow: slotBelow,
    lastBlock: lowestBlock,
    isComplete: E.isComplete,
    commit: store.commit,
    snapshot: snapshot,
    save: save,
    renderAll: renderAll,
    getSelection: store.getSelection,
    setSelection: store.setSelection,
    clearSelection: store.clearSelection,
    getActiveBlockId: store.getActiveBlockId,
    setActiveBlockId: store.setActiveBlockId,
    removeBlock: removeBlock,
    deleteBlock: deleteBlock,
    clearCanvas: clearCanvas,
    linkedValue: linkedValue,
    resolve: resolve,
    fmt: fmt,
    findTermByTid: E.findTermByTid,
    parseExpression: parseExpression,
    diagnose: E.diagnose,
    createsCycle: createsCycle,
    freezeTermDependents: freezeTermDependents,
    setLinkStatus: setLinkStatus,
    notifyLinkedNeg: notifyLinkedNeg
  });
  function pressKey(k){ inputCtl.pressKey(k); }
  function pasteText(text){ return inputCtl.pasteText(text); }
  function currentSelectionText(){ return inputCtl.currentSelectionText(); }
  function copySelection(){ return inputCtl.copySelection(); }
  function structuredBlockText(){ return inputCtl.structuredBlockText(); }
  function structuredCanvasText(){ return inputCtl.structuredCanvasText(); }

  CanvasInteractions.create({
    document: document,
    canvas: canvas,
    wrap: wrap,
    ghost: document.getElementById('ghost'),
    byId: byId,
    blockEl: blockEl,
    blocksMap: blocksMap,
    drawLinks: drawLinks,
    invalidateBlock: invalidateBlock,
    snapshot: snapshot,
    save: save,
    renderAll: renderAll,
    clearSelection: store.clearSelection,
    setSelection: store.setSelection,
    getSelection: store.getSelection,
    getActiveBlockId: store.getActiveBlockId,
    setActiveBlockId: store.setActiveBlockId,
    getZoom: function(){ return zoom; },
    snap: snap,
    newBlock: newBlock,
    removeBlock: removeBlock,
    createsCycle: createsCycle,
    confirmDialog: confirmDialog,
    deleteBlock: deleteBlock,
    zoomAround: zoomAround,
    Editing: Editing
  });

  // ---------- Adding calculations ----------
  function addBlockAt(x, y) {
    store.commit(function(){
      var nb = newBlock(snap(x), snap(y));
      store.setActiveBlockId(nb.id); store.clearSelection();
    });
  }
  (function(){
    var btn = document.getElementById('addBtn');
    btn.addEventListener('pointerdown', function(e){ e.stopPropagation(); });
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      var x = parseInt(btn.style.left,10); if (isNaN(x)) x = 40;
      var y = parseInt(btn.style.top,10);  if (isNaN(y)) y = 30;
      addBlockAt(x, y);
    });
    // Empty-canvas taps create in place; the hint mark remains a keyboardable
    // first-run control for users who want an explicit target.
    var hintMark = document.querySelector('.hint-mark');
    if (hintMark) {
      hintMark.addEventListener('pointerdown', function(e){ e.stopPropagation(); });
      hintMark.addEventListener('click', function(e){ e.stopPropagation(); addBlockAt(40, 30); });
      hintMark.addEventListener('keydown', function(e){
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault(); e.stopPropagation(); addBlockAt(40, 30);
      });
    }
  })();

  // ---------- Numpad ----------
  document.querySelector('.padgrid').addEventListener('pointerdown', function(e){
    var key = e.target.closest('.key'); if(!key) return;
    e.preventDefault(); // fire immediately; don't wait for (and risk losing) the click
    pressKey(key.dataset.k);
  });
  document.querySelector('.padgrid').addEventListener('click', function(e){
    var key = e.target.closest('.key'); if(!key || e.detail !== 0) return;
    e.preventDefault();
    pressKey(key.dataset.k);
  });
  document.getElementById('padToggle').addEventListener('click', function(){
    var np=document.getElementById('numpad');
    var hidden = np.classList.toggle('hidden');
    this.setAttribute('aria-label', hidden ? 'Show keypad' : 'Hide keypad');
    this.setAttribute('aria-expanded', hidden ? 'false' : 'true');
    layoutOverlays();
  });
  window.addEventListener('resize', function(){ updateViewport(); layoutOverlays(); });

  // ---------- Toolbar ----------
  function closeOverflowMenu() {
    var menu = document.getElementById('menu');
    var menuBtn = document.getElementById('menuBtn');
    if (menu) menu.hidden = true;
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
  }
  document.getElementById('undoBtn').onclick = undo;
  document.getElementById('redoBtn').onclick = redo;
  document.getElementById('clearBtn').onclick = function(){ closeOverflowMenu(); clearCanvas(); };
  function syncSizeMenu(){
    Array.prototype.forEach.call(document.querySelectorAll('.size-item'), function(b){
      b.setAttribute('aria-checked', Number(b.dataset.size)===state.fontSize ? 'true' : 'false');
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.size-item'), function(btn){
    btn.onclick = function(){
      state.fontSize = Number(this.dataset.size);
      syncSizeMenu(); save(); renderAll();
      closeOverflowMenu();
    };
  });
  function setSidebarOpen(open) {
    var sb = document.getElementById('sidebar');
    var varsBtn = document.getElementById('varsBtn');
    sb.classList.toggle('open', open);
    sb.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('sidebar-open', open);
    if (varsBtn) varsBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
    layoutOverlays();
    if (open) renderSidebar();
  }
  document.getElementById('varsBtn').onclick = function(){
    var sb = document.getElementById('sidebar');
    setSidebarOpen(!sb.classList.contains('open'));
    closeOverflowMenu();
  };
  document.getElementById('sidebarClose').onclick = function(){
    setSidebarOpen(false);
  };
  (function(){ var c = document.getElementById('linkTipClose'); if (c) c.onclick = retireLinkTip; })();
  document.getElementById('sidebarScrim').onclick = function(){
    setSidebarOpen(false);
  };

  // ---------- Overflow menu ----------
  function applyGrid() {
    canvas.classList.toggle('grid-on', !!state.showGrid);
    var gt = document.getElementById('gridToggle');
    gt.setAttribute('aria-checked', state.showGrid ? 'true' : 'false');
  }
  (function(){
    var menuBtn = document.getElementById('menuBtn');
    var menu = document.getElementById('menu');
    var items = Array.prototype.slice.call(menu.querySelectorAll('.menu-item'));
    function openMenu(){
      menu.hidden = false; menuBtn.setAttribute('aria-expanded','true');
      if (items[0]) items[0].focus();
    }
    function closeMenu(restoreFocus){
      menu.hidden = true; menuBtn.setAttribute('aria-expanded','false');
      if (restoreFocus && menuBtn.focus) menuBtn.focus();
    }
    function focusMenuItem(delta) {
      var idx = items.indexOf(document.activeElement);
      if (idx < 0) idx = delta > 0 ? -1 : 0;
      items[(idx + delta + items.length) % items.length].focus();
    }
    menuBtn.addEventListener('click', function(e){
      e.stopPropagation();
      if (menu.hidden) openMenu(); else closeMenu(false);
    });
    menuBtn.addEventListener('keydown', function(e){
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      e.stopPropagation();
      if (menu.hidden) openMenu(); else closeMenu(true);
    });
    menu.addEventListener('keydown', function(e){
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); focusMenuItem(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); focusMenuItem(-1); return; }
      if (e.key === 'Home') { e.preventDefault(); if (items[0]) items[0].focus(); return; }
      if (e.key === 'End') { e.preventDefault(); if (items.length) items[items.length - 1].focus(); }
    });
    document.addEventListener('pointerdown', function(e){
      if (!menu.hidden && !e.target.closest('.menu-wrap')) closeMenu(false);
    });
    document.getElementById('gridToggle').addEventListener('click', function(){
      state.showGrid = !state.showGrid; applyGrid(); save(); closeMenu(false);
    });
    document.getElementById('copyItem').addEventListener('click', function(){
      var t = copySelection();
      if (t==null || t==='') { showNotice('Select a number, result, or calculation to copy.'); closeMenu(false); return; }
      if (!navigator.clipboard || !navigator.clipboard.writeText) { showNotice('Clipboard copy is not available.'); closeMenu(false); return; }
      navigator.clipboard.writeText(t).catch(function(){ showNotice('Could not copy to the clipboard.'); });
      closeMenu(false);
    });
    document.getElementById('copyStructuredBlockItem').addEventListener('click', function(){
      var t = structuredBlockText();
      if (t==null || t==='') { showNotice('Select a calculation block to export.'); closeMenu(false); return; }
      if (!navigator.clipboard || !navigator.clipboard.writeText) { showNotice('Clipboard copy is not available.'); closeMenu(false); return; }
      navigator.clipboard.writeText(t).catch(function(){ showNotice('Could not copy to the clipboard.'); });
      closeMenu(false);
    });
    document.getElementById('copyCanvasSummaryItem').addEventListener('click', function(){
      var t = structuredCanvasText();
      if (!navigator.clipboard || !navigator.clipboard.writeText) { showNotice('Clipboard copy is not available.'); closeMenu(false); return; }
      navigator.clipboard.writeText(t).catch(function(){ showNotice('Could not copy to the clipboard.'); });
      closeMenu(false);
    });
    document.getElementById('pasteItem').addEventListener('click', function(){
      closeMenu(false);
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function(t){
          if (!pasteText(t)) showNotice('Paste a calculation like 12 + 3 * (4).');
        }).catch(function(){ showNotice('Could not read from the clipboard.'); });
      } else {
        showNotice('Clipboard paste is not available.');
      }
    });
  })();

  // Desktop copy/paste via keyboard (events fire on Cmd/Ctrl+C / +V).
  document.addEventListener('copy', function(e){
    var ae = document.activeElement;
    if (ae && (ae.isContentEditable || ae.tagName==='INPUT' || ae.tagName==='TEXTAREA')) return;
    var t = copySelection();
    if (t!=null && t!=='') { e.clipboardData.setData('text/plain', t); e.preventDefault(); }
  });
  document.addEventListener('paste', function(e){
    var ae = document.activeElement;
    if (ae && (ae.isContentEditable || ae.tagName==='INPUT' || ae.tagName==='TEXTAREA')) return;
    var t = e.clipboardData.getData('text/plain');
    if (t) {
      e.preventDefault();
      if (!pasteText(t)) showNotice('Paste a calculation like 12 + 3 * (4).');
    }
  });

  // ---------- Zoom controls ----------
  document.getElementById('zoomIn').addEventListener('click', function(){ zoomByCenter(1.2); });
  document.getElementById('zoomOut').addEventListener('click', function(){ zoomByCenter(1/1.2); });
  document.getElementById('zoomLevel').addEventListener('click', resetZoom);

  // physical keyboard support (nice for desktop testing)
  window.addEventListener('keydown', function(e){
    var ae = document.activeElement;
    if (ae && (ae.isContentEditable || ae.tagName==='INPUT' || ae.tagName==='TEXTAREA')) return;
    var k=e.key;
    if (k>='0'&&k<='9') pressKey(k);
    else if (k==='.'||k===',') pressKey('.'); // accept comma decimal (locale keyboards)
    else if (k==='+'||k==='-'||k==='*'||k==='/') pressKey(k);
    else if (k==='('||k===')') pressKey(k);
    else if (k==='Backspace') { e.preventDefault(); pressKey('back'); }
    else if (k==='='||k==='Enter') { e.preventDefault(); pressKey('='); }
    else if (k==='Delete') { e.preventDefault(); pressKey('del'); }
    else if ((k==='l'||k==='L')&&!e.metaKey&&!e.ctrlKey) { e.preventDefault(); pressKey('link'); }
    else if (k==='Escape') { pressKey('link-cancel'); }
    else if (k==='z'&&(e.metaKey||e.ctrlKey)) { e.preventDefault(); e.shiftKey?redo():undo(); }
    else if (k==='y'&&(e.metaKey||e.ctrlKey)) { e.preventDefault(); redo(); } // Windows-style redo
    else if (k==='ArrowLeft'||k==='ArrowRight'||k==='ArrowUp'||k==='ArrowDown') {
      var step = e.shiftKey ? SNAP*5 : SNAP;
      var dx = k==='ArrowLeft'?-step : k==='ArrowRight'?step : 0;
      var dy = k==='ArrowUp'?-step : k==='ArrowDown'?step : 0;
      if (nudgeSelectedBlock(dx, dy)) e.preventDefault(); // only when a block is selected
    }
  });

  // Move the selected block with the arrow keys (Shift = larger step), so blocks
  // can be repositioned without a pointer. Returns false when nothing is selected
  // so the arrow keys fall through to their default behavior.
  function nudgeSelectedBlock(dx, dy) {
    var sel = store.getSelection();
    if (sel.kind !== 'result' || sel.blockId == null) return false;
    var b = byId(sel.blockId);
    if (!b) return false;
    store.commit(function(){
      b.x = Math.max(0, snap(b.x + dx));
      b.y = Math.max(0, snap(b.y + dy));
    });
    return true;
  }

  // ---------- Init ----------
  load();
  if (state.fontSize && FONT_SIZES.indexOf(state.fontSize)<0) state.fontSize=22;
  syncSizeMenu();
  applyGrid();
  applyCanvasName();
  updateZoomLabel();
  // show the locale's decimal separator on the keypad (model still stores '.')
  var decKey = document.querySelector('.padgrid .key[data-k="."]');
  if (decKey) decKey.textContent = NUM_DECIMAL;
  renderAll();
  layoutOverlays();
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}
