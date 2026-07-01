/* Canvas Calc - variables sidebar rendering and inline editing. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CanvasSidebar = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

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

  function blockDisplayName(block) {
    if (!block) return 'Missing source';
    var label = String(block.label || '').trim();
    return label || ('Block ' + block.id);
  }

  function countLinks(block) {
    var count = 0;
    if (!block || !block.terms) return count;
    block.terms.forEach(function (t) { if (t.type === 'linked') count++; });
    return count;
  }

  function blockMapFromList(blocks) {
    var map = {};
    (blocks || []).forEach(function (b) { map[b.id] = b; });
    return map;
  }

  function directDependencies(block, blocks) {
    var byId = blockMapFromList(blocks);
    var seen = {};
    var deps = [];
    if (!block || !block.terms) return deps;
    block.terms.forEach(function (t) {
      if (t.type !== 'linked' || seen[t.sourceId]) return;
      seen[t.sourceId] = true;
      deps.push({ id: t.sourceId, label: blockDisplayName(byId[t.sourceId]) });
    });
    return deps;
  }

  function directDependents(block, blocks) {
    var deps = [];
    if (!block) return deps;
    (blocks || []).forEach(function (b) {
      if (!b || b.id === block.id || !b.terms) return;
      for (var i = 0; i < b.terms.length; i++) {
        if (b.terms[i].type === 'linked' && b.terms[i].sourceId === block.id) {
          deps.push({ id: b.id, label: blockDisplayName(b) });
          return;
        }
      }
    });
    return deps;
  }

  function formatHealthList(items) {
    if (!items || !items.length) return 'None';
    var labels = items.slice(0, 3).map(function (item) { return item.label; });
    if (items.length > 3) labels.push('+' + (items.length - 3));
    return labels.join(', ');
  }

  function collectBlockHealth(block, blocks, map, diagnose, fmt) {
    var diag = block && diagnose ? diagnose(block, map || {}) : null;
    var status = 'incomplete';
    var statusText = 'Incomplete';
    var reason = '';
    if (diag && diag.status === 'ok') {
      status = 'ok';
      statusText = diag.value == null ? 'Resolved' : 'Resolved · ' + (fmt ? fmt(diag.value) : String(diag.value));
    } else if (diag && diag.status === 'unresolved') {
      status = 'unresolved';
      statusText = 'Unresolved';
      reason = diag.message || 'Expression needs attention.';
    }
    return {
      id: block ? block.id : '',
      title: blockDisplayName(block),
      status: status,
      statusText: statusText,
      reason: reason,
      linkCount: countLinks(block),
      uses: directDependencies(block, blocks),
      usedBy: directDependents(block, blocks)
    };
  }

  function create(deps) {
    var doc = deps.document || document;

    function cur() { return deps.cur(); }

    // One entry per block (in canvas order): its number operands plus whether
    // the block currently evaluates to a result. Empty drafts are skipped.
    function collectGroups() {
      var groups = [];
      cur().blocks.forEach(function (b) {
        var inputs = [];
        b.terms.forEach(function (t, idx) {
          if (t.type === 'number') inputs.push({ bid: b.id, idx: idx, t: t });
        });
        var isResult = deps.isComplete(b.terms) && deps.missingOperatorIndex(b.terms) < 0;
        if (!inputs.length && !isResult) return;
        groups.push({ block: b, inputs: inputs, isResult: isResult });
      });
      return groups;
    }

    function sidebarOpen() { return deps.sidebar.classList.contains('open'); }

    function syncSidebar() {
      if (!sidebarOpen()) return;
      if (deps.sidebar.contains(doc.activeElement)) refreshSidebarValues();
      else renderSidebar();
    }

    function scheduleSidebarRebuild() {
      setTimeout(function () {
        if (deps.sidebar.classList.contains('open') && !deps.sidebar.contains(doc.activeElement)) renderSidebar();
      }, 0);
    }

    function refreshSidebarValues() {
      var map = deps.blocksMap();
      deps.sidebarBody.querySelectorAll('.health-panel[data-bid]').forEach(function (el) {
        var b = deps.byId(el.dataset.bid); if (b) applyHealthPanel(el, b, map);
      });
      deps.sidebarBody.querySelectorAll('.var-val[data-kind="result"]').forEach(function (el) {
        var b = deps.byId(el.dataset.bid); if (b) el.textContent = deps.fmt(deps.resolve(b, map));
      });
      deps.sidebarBody.querySelectorAll('.var-def').forEach(function (el) {
        var b = deps.byId(el.dataset.bid); if (b) el.textContent = '= ' + deps.blockDefinition(b, map);
      });
      deps.sidebarBody.querySelectorAll('.var-val[data-kind="input"]').forEach(function (el) {
        if (el === doc.activeElement) return;
        var b = deps.byId(el.dataset.bid); if (!b) return;
        var t = b.terms[el.dataset.idx]; if (t) el.value = deps.groupDisplay(t.value);
      });
    }

    function renderSidebar() {
      var body = deps.sidebarBody;
      var map = deps.blocksMap();
      var groups = collectGroups();
      var selected = selectedBlock();
      body.innerHTML = '';

      if (selected) body.appendChild(healthPanel(selected, map));

      if (!groups.length) {
        if (selected) return;
        var e = doc.createElement('div'); e.className = 'var-empty';
        e.textContent = 'No variables yet. Numbers and results show up here once you start a calculation - tap a name to label them.';
        body.appendChild(e);
        return;
      }

      // Each block becomes a group: its result (or a pending marker) as the
      // heading, with the block's number operands nested below it.
      groups.forEach(function (g) {
        var sec = doc.createElement('div'); sec.className = 'var-group';
        sec.appendChild(groupHead(g.block, g.isResult, map));
        g.inputs.forEach(function (it) { sec.appendChild(inputRow(it)); });
        body.appendChild(sec);
      });
    }

    function selectedBlock() {
      var sel = deps.getSelection ? deps.getSelection() : {};
      var id = sel && sel.blockId;
      if (id == null && deps.getActiveBlockId) id = deps.getActiveBlockId();
      return id == null ? null : deps.byId(id);
    }

    function healthMetric(label, key) {
      var item = doc.createElement('div');
      item.className = 'health-metric';
      var l = doc.createElement('span');
      l.textContent = label;
      var v = doc.createElement('strong');
      v.dataset.health = key;
      item.appendChild(l);
      item.appendChild(v);
      return item;
    }

    function healthPanel(b, map) {
      var panel = doc.createElement('div');
      panel.className = 'health-panel';
      panel.dataset.bid = b.id;

      var label = doc.createElement('div');
      label.className = 'health-label';
      label.textContent = 'Selected block';

      var title = doc.createElement('div');
      title.className = 'health-title';
      title.dataset.health = 'title';

      var status = doc.createElement('div');
      status.className = 'health-status';
      status.dataset.health = 'status';

      var reason = doc.createElement('div');
      reason.className = 'health-reason';
      reason.dataset.health = 'reason';

      var grid = doc.createElement('div');
      grid.className = 'health-grid';
      grid.appendChild(healthMetric('Links', 'links'));
      grid.appendChild(healthMetric('Uses', 'uses'));
      grid.appendChild(healthMetric('Used by', 'used-by'));

      panel.appendChild(label);
      panel.appendChild(title);
      panel.appendChild(status);
      panel.appendChild(reason);
      panel.appendChild(grid);
      applyHealthPanel(panel, b, map);
      return panel;
    }

    function applyHealthPanel(panel, b, map) {
      var info = collectBlockHealth(b, cur().blocks, map, deps.diagnose, deps.fmt);
      panel.dataset.bid = info.id;
      panel.querySelector('[data-health="title"]').textContent = info.title;
      var status = panel.querySelector('[data-health="status"]');
      status.className = 'health-status ' + info.status;
      status.textContent = info.statusText;
      var reason = panel.querySelector('[data-health="reason"]');
      reason.textContent = info.reason;
      reason.hidden = !info.reason;
      panel.querySelector('[data-health="links"]').textContent = String(info.linkCount);
      panel.querySelector('[data-health="uses"]').textContent = formatHealthList(info.uses);
      panel.querySelector('[data-health="used-by"]').textContent = formatHealthList(info.usedBy);
    }

    function inputRow(it) {
      var row = doc.createElement('div'); row.className = 'var-row';

      var name = doc.createElement('input');
      name.className = 'var-name'; name.value = it.t.label || '';
      name.placeholder = 'unnamed';
      var nameDirty = false;
      name.addEventListener('focus', function () { nameDirty = false; });
      name.addEventListener('input', function () {
        var b = deps.byId(it.bid); if (!b) return;
        var t = b.terms[it.idx]; if (!t) return;
        if (!nameDirty) { deps.snapshot(); nameDirty = true; }
        t.label = name.value; deps.save(); deps.renderAll();
      });
      name.addEventListener('blur', function () { nameDirty = false; scheduleSidebarRebuild(); });

      var val = doc.createElement('input');
      val.className = 'var-val'; val.value = deps.groupDisplay(it.t.value);
      val.inputMode = 'decimal';
      val.dataset.bid = it.bid; val.dataset.idx = it.idx; val.dataset.kind = 'input';
      var valDirty = false;
      val.addEventListener('focus', function () {
        valDirty = false;
        var b = deps.byId(it.bid), t = b && b.terms[it.idx];
        if (t) val.value = t.value;
      });
      val.addEventListener('input', function () {
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
        deps.save(); deps.renderAll();
      });
      val.addEventListener('blur', function () {
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
      name.addEventListener('focus', function () { nameDirty = false; });
      name.addEventListener('input', function () {
        var nb = deps.byId(b.id); if (!nb) return;
        if (!nameDirty) { deps.snapshot(); nameDirty = true; }
        nb.label = name.value; deps.save(); deps.renderAll();
      });
      name.addEventListener('blur', function () { nameDirty = false; scheduleSidebarRebuild(); });
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
        pend.textContent = '...';
        row.appendChild(pend);
      }

      return row;
    }

    return {
      renderSidebar: renderSidebar,
      syncSidebar: syncSidebar,
      scheduleSidebarRebuild: scheduleSidebarRebuild
    };
  }

  return {
    create: create,
    normalizeSidebarNumber: normalizeSidebarNumber,
    blockDisplayName: blockDisplayName,
    countLinks: countLinks,
    directDependencies: directDependencies,
    directDependents: directDependents,
    formatHealthList: formatHealthList,
    collectBlockHealth: collectBlockHealth
  };
});
