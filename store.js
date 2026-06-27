/* Canvas Calc - view state + mutation policy.
 * Owns the transient selection / active-block state (a single source of truth,
 * instead of closures scattered across modules) and centralizes the
 * snapshot -> mutate -> render -> save sequence via commit(), so call sites
 * can't forget a render or a save after changing the model.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CanvasStore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function emptySelection() { return { blockId: null, termIndex: null, kind: null }; }

  // deps: { snapshot, renderAll, save } — supplied by the app controller.
  function create(deps) {
    var sel = emptySelection();
    var activeBlockId = null;

    function getSelection() { return sel; }
    function setSelection(next) {
      sel = next ? { blockId: next.blockId, termIndex: next.termIndex, kind: next.kind } : emptySelection();
    }
    function clearSelection() { sel = emptySelection(); }
    function getActiveBlockId() { return activeBlockId; }
    function setActiveBlockId(id) { activeBlockId = id; }

    // Apply a model mutation, then the standard render/save policy.
    //   opts.snapshot (default true): push an undo step before mutating.
    //   opts.save     (default true): persist after mutating.
    // If mutate() throws, the error is not swallowed and render/save are skipped.
    // Pass {snapshot:false, save:false} for a selection-only change that needs a
    // redraw but no history/persistence.
    function commit(mutate, opts) {
      opts = opts || {};
      if (opts.snapshot !== false) deps.snapshot();
      mutate();
      deps.renderAll();
      if (opts.save !== false) deps.save();
    }

    return {
      getSelection: getSelection,
      setSelection: setSelection,
      clearSelection: clearSelection,
      getActiveBlockId: getActiveBlockId,
      setActiveBlockId: setActiveBlockId,
      commit: commit
    };
  }

  return { create: create, emptySelection: emptySelection };
});
