/* Canvas Calc - app state helpers.
 * Pure-ish data normalization and lookup helpers. No DOM and no storage.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CanvasState = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function freshCanvas(id, title) {
    return { id: id, title: title, blocks: [], nextId: 1, nextTid: 1, zoom: 1 };
  }

  function isOp(v) { return v === '+' || v === '-' || v === '*' || v === '/'; }

  function positiveInt(v, fallback) {
    var n = parseInt(v, 10);
    return (isFinite(n) && n > 0) ? n : fallback;
  }

  function positiveNumber(v, fallback) {
    var n = Number(v);
    return (isFinite(n) && n > 0) ? n : fallback;
  }

  function cloneData(input) {
    if (!input || typeof input !== 'object') return input;
    return JSON.parse(JSON.stringify(input));
  }

  function idNumber(id, prefix) {
    if (typeof id !== 'string') return 0;
    var m = new RegExp('^' + prefix + '(\\d+)$').exec(id);
    return m ? parseInt(m[1], 10) : 0;
  }

  function nextFreeId(used, prefix, start) {
    var n = positiveInt(start, 1), id;
    do { id = prefix + (n++); } while (used[id]);
    used[id] = true;
    return { id: id, next: n };
  }

  function normalizeTerm(t) {
    if (!t || typeof t !== 'object' || typeof t.type !== 'string') return null;
    if (t.type === 'number') {
      t.value = (t.value == null) ? '' : String(t.value);
      if (typeof t.label !== 'string') t.label = '';
      if (t.tid != null && typeof t.tid !== 'string') t.tid = String(t.tid);
      return t;
    }
    if (t.type === 'operator') {
      if (!isOp(t.value)) return null;
      return { type: 'operator', value: t.value };
    }
    if (t.type === 'paren') {
      return (t.value === '(' || t.value === ')') ? { type: 'paren', value: t.value } : null;
    }
    if (t.type === 'linked') {
      if (typeof t.sourceId !== 'string') return null;
      return {
        type: 'linked',
        sourceId: t.sourceId,
        sourceTid: t.sourceTid == null ? null : String(t.sourceTid)
      };
    }
    return null;
  }

  function migrateState(s) {
    if (s && s.canvases) return s;
    if (s && s.blocks) {
      return {
        canvases: [{
          id: 'c1',
          title: 'Canvas 1',
          blocks: s.blocks || [],
          nextId: s.nextId || 1,
          nextTid: s.nextTid || 1,
          zoom: positiveNumber(s.zoom, 1)
        }],
        activeCanvasId: 'c1',
        nextCanvasId: 2,
        fontSize: s.fontSize || 22,
        showGrid: !!s.showGrid
      };
    }
    return s;
  }

  function normalizeCanvas(state, c, usedCanvasIds) {
    var picked;
    c.nextId = positiveInt(c.nextId, 1);
    c.nextTid = positiveInt(c.nextTid, 1);
    if (typeof c.id !== 'string' || usedCanvasIds[c.id]) {
      picked = nextFreeId(usedCanvasIds, 'c', state.nextCanvasId);
      c.id = picked.id; state.nextCanvasId = picked.next;
    } else {
      usedCanvasIds[c.id] = true;
      state.nextCanvasId = Math.max(state.nextCanvasId, idNumber(c.id, 'c') + 1);
    }
    c.zoom = positiveNumber(c.zoom, 1);
    if (!c.title) c.title = 'Canvas';
    if (!Array.isArray(c.blocks)) c.blocks = [];
    var usedBlockIds = {};
    c.blocks = c.blocks.filter(function (b) { return b && typeof b === 'object'; });
    c.blocks.forEach(function (b) {
      if (typeof b.id !== 'string' || usedBlockIds[b.id]) {
        picked = nextFreeId(usedBlockIds, 'b', c.nextId);
        b.id = picked.id; c.nextId = picked.next;
      } else {
        usedBlockIds[b.id] = true;
        c.nextId = Math.max(c.nextId, idNumber(b.id, 'b') + 1);
      }
      if (!Array.isArray(b.terms)) b.terms = [];
      b.terms = b.terms.map(normalizeTerm).filter(Boolean);
      if (typeof b.x !== 'number' || !isFinite(b.x)) b.x = 40;
      if (typeof b.y !== 'number' || !isFinite(b.y)) b.y = 30;
      if (typeof b.label !== 'string') b.label = '';
    });
  }

  function ensureTids(state) {
    state.canvases.forEach(function (c) {
      var usedTid = {}, picked;
      c.nextTid = positiveInt(c.nextTid, 1);
      c.blocks.forEach(function (b) {
        b.terms.forEach(function (t) {
          if (t.type !== 'number') return;
          if (typeof t.tid !== 'string' || usedTid[t.tid]) {
            picked = nextFreeId(usedTid, 't', c.nextTid);
            t.tid = picked.id; c.nextTid = picked.next;
          } else {
            usedTid[t.tid] = true;
            c.nextTid = Math.max(c.nextTid, idNumber(t.tid, 't') + 1);
          }
        });
      });
    });
    return state;
  }

  function normalizeState(input) {
    var state = migrateState(cloneData(input));
    if (!state || typeof state !== 'object') state = {};
    if (!Array.isArray(state.canvases) || !state.canvases.length) state.canvases = [freshCanvas('c1', 'Canvas 1')];
    state.nextCanvasId = positiveInt(state.nextCanvasId, state.canvases.length + 1);
    state.canvases = state.canvases.filter(function (c) { return c && typeof c === 'object'; });
    if (!state.canvases.length) state.canvases = [freshCanvas('c1', 'Canvas 1')];
    var usedCanvasIds = {};
    state.canvases.forEach(function (c) { normalizeCanvas(state, c, usedCanvasIds); });
    if (!state.activeCanvasId || !state.canvases.some(function (c) { return c.id === state.activeCanvasId; })) {
      state.activeCanvasId = state.canvases[0].id;
    }
    if (!state.fontSize) state.fontSize = 22;
    if (state.showGrid === undefined) state.showGrid = false;
    ensureTids(state);
    return state;
  }

  function byId(canvas, id) {
    var bs = canvas.blocks;
    for (var i = 0; i < bs.length; i++) if (bs[i].id === id) return bs[i];
    return null;
  }

  function blocksMap(canvas) {
    var m = {};
    canvas.blocks.forEach(function (b) { m[b.id] = b; });
    return m;
  }

  return {
    freshCanvas: freshCanvas,
    normalizeState: normalizeState,
    ensureTids: ensureTids,
    byId: byId,
    blocksMap: blocksMap
  };
});
