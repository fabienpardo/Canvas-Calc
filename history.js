/* Canvas Calc - per-canvas undo/redo history.
 * Snapshots the active canvas's blocks; no DOM access beyond the injected
 * undo/redo button elements, which keeps the stack logic unit-testable.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CanvasHistory = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMIT = 60; // cap on retained undo steps per canvas

  function create(deps) {
    var undoStacks = {}; // canvasId -> { history:[], future:[] }

    function stacks() {
      var id = deps.getActiveCanvasId();
      if (!undoStacks[id]) undoStacks[id] = { history: [], future: [] };
      return undoStacks[id];
    }
    function snapOf() {
      var c = deps.cur();
      return JSON.stringify({ blocks: c.blocks, nextId: c.nextId, nextTid: c.nextTid });
    }
    function applySnap(s) {
      var c = deps.cur();
      c.blocks = s.blocks; c.nextId = s.nextId; if (s.nextTid) c.nextTid = s.nextTid;
    }
    function snapshot() {
      var st = stacks();
      st.history.push(snapOf());
      if (st.history.length > LIMIT) st.history.shift();
      st.future = [];
      updateButtons();
    }
    function restore(fromKey, toKey) {
      var st = stacks();
      if (!st[fromKey].length) return;
      st[toKey].push(snapOf());
      applySnap(JSON.parse(st[fromKey].pop()));
      deps.clearSelection(); deps.setActiveBlockId(null); deps.renderAll(); deps.save(); updateButtons();
    }
    function undo() { restore('history', 'future'); }
    function redo() { restore('future', 'history'); }
    function updateButtons() {
      var st = stacks();
      deps.undoBtn.disabled = !st.history.length;
      deps.redoBtn.disabled = !st.future.length;
    }
    function deleteStack(id) { delete undoStacks[id]; }

    return {
      snapshot: snapshot,
      undo: undo,
      redo: redo,
      updateButtons: updateButtons,
      deleteStack: deleteStack
    };
  }

  return { create: create };
});
