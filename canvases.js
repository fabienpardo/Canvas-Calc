/* Canvas Calc - multi-canvas toolbar/menu wiring. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CanvasCanvases = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(deps) {
    var document = deps.document;
    var stateApi = deps.State;
    var wrap = deps.wrap;
    var canvasMenuEl = document.getElementById('canvasMenu');
    var canvasBtnEl = document.getElementById('canvasBtn');

    function state() { return deps.getState(); }
    function cur() { return deps.cur(); }

    function applyCanvasName() {
      document.getElementById('canvasName').textContent = cur().title || 'Canvas';
    }

    function closeCanvasMenu() {
      canvasMenuEl.hidden = true;
      canvasBtnEl.setAttribute('aria-expanded', 'false');
    }

    function setActiveCanvas(id) {
      var s = state();
      if (!s.canvases.some(function (c) { return c.id === id; })) return;
      s.activeCanvasId = id;
      deps.setZoom(deps.clampZoom(cur().zoom));
      deps.clearSelection();
      deps.setActiveBlockId(null);
      wrap.scrollLeft = 0;
      wrap.scrollTop = 0;
      applyCanvasName();
      deps.updateZoomLabel();
      deps.renderAll();
      deps.layoutOverlays();
      deps.save();
    }

    function addCanvas() {
      var s = state();
      var id = 'c' + (s.nextCanvasId++);
      var c = stateApi.freshCanvas(id, '');
      s.canvases.push(c);
      c.title = 'Canvas ' + s.canvases.length;
      closeCanvasMenu();
      setActiveCanvas(id);
    }

    function renameCanvas(id, title) {
      var s = state();
      var c = s.canvases.filter(function (x) { return x.id === id; })[0];
      if (!c) return;
      c.title = title;
      if (id === s.activeCanvasId) applyCanvasName();
      deps.save();
    }

    function deleteCanvas(id) {
      var s = state();
      if (s.canvases.length <= 1) return;
      var c = s.canvases.filter(function (x) { return x.id === id; })[0];
      if (!c) return;
      deps.confirmDialog('Delete "' + (c.title || 'this canvas') + '" and all its calculations?', function () {
        s.canvases = s.canvases.filter(function (x) { return x.id !== id; });
        deps.deleteUndoStack(id);
        closeCanvasMenu();
        if (s.activeCanvasId === id) setActiveCanvas(s.canvases[0].id);
        else deps.save();
      }, 'Delete', true);
    }

    function renderCanvasMenu() {
      var s = state();
      canvasMenuEl.innerHTML = '';
      s.canvases.forEach(function (c) {
        var row = document.createElement('div');
        var active = c.id === s.activeCanvasId;
        row.className = 'cv-row' + (active ? ' active' : '');
        var name;
        if (active) {
          name = document.createElement('input');
          name.className = 'cv-name';
          name.value = c.title;
          name.addEventListener('input', function () { renameCanvas(c.id, name.value); });
          name.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
              e.preventDefault();
              name.blur();
            }
          });
        } else {
          name = document.createElement('button');
          name.className = 'cv-name';
          name.textContent = c.title;
          name.addEventListener('click', function () {
            setActiveCanvas(c.id);
            closeCanvasMenu();
          });
        }
        var del = document.createElement('button');
        del.className = 'cv-del';
        del.textContent = '×';
        del.setAttribute('aria-label', 'Delete canvas');
        if (s.canvases.length <= 1) del.disabled = true;
        del.addEventListener('click', function (e) {
          e.stopPropagation();
          deleteCanvas(c.id);
        });
        row.appendChild(name);
        row.appendChild(del);
        canvasMenuEl.appendChild(row);
      });
      var add = document.createElement('button');
      add.className = 'cv-new';
      add.textContent = '+ New canvas';
      add.addEventListener('click', function (e) {
        e.stopPropagation();
        addCanvas();
      });
      canvasMenuEl.appendChild(add);
    }

    function openCanvasMenu() {
      renderCanvasMenu();
      canvasMenuEl.hidden = false;
      canvasBtnEl.setAttribute('aria-expanded', 'true');
    }

    canvasBtnEl.addEventListener('click', function (e) {
      e.stopPropagation();
      if (canvasMenuEl.hidden) openCanvasMenu();
      else closeCanvasMenu();
    });

    document.addEventListener('pointerdown', function (e) {
      if (!canvasMenuEl.hidden && !e.target.closest('.cv-switch')) closeCanvasMenu();
    });

    return {
      applyCanvasName: applyCanvasName,
      setActiveCanvas: setActiveCanvas,
      closeCanvasMenu: closeCanvasMenu,
      openCanvasMenu: openCanvasMenu,
      renderCanvasMenu: renderCanvasMenu
    };
  }

  return {
    create: create
  };
});
