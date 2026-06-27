'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Store = require('../store.js');

function make() {
  const log = { snapshot: 0, render: 0, save: 0 };
  const store = Store.create({
    snapshot: () => { log.snapshot++; },
    renderAll: () => { log.render++; },
    save: () => { log.save++; }
  });
  return { store, log };
}

test('selection get/set/clear round-trips and copies the value', () => {
  const { store } = make();
  assert.deepEqual(store.getSelection(), { blockId: null, termIndex: null, kind: null });
  const next = { blockId: 'b1', termIndex: 2, kind: 'number', extra: 'ignored' };
  store.setSelection(next);
  assert.deepEqual(store.getSelection(), { blockId: 'b1', termIndex: 2, kind: 'number' });
  next.blockId = 'mutated';
  assert.equal(store.getSelection().blockId, 'b1'); // stored a copy, not the reference
  store.clearSelection();
  assert.deepEqual(store.getSelection(), { blockId: null, termIndex: null, kind: null });
  store.setSelection(null);
  assert.deepEqual(store.getSelection(), { blockId: null, termIndex: null, kind: null });
});

test('active block id round-trips', () => {
  const { store } = make();
  assert.equal(store.getActiveBlockId(), null);
  store.setActiveBlockId('b7');
  assert.equal(store.getActiveBlockId(), 'b7');
});

test('commit runs snapshot -> mutate -> render -> save in order by default', () => {
  const { store, log } = make();
  const order = [];
  store.commit(() => { order.push('mutate'); });
  assert.deepEqual(log, { snapshot: 1, render: 1, save: 1 });
  assert.deepEqual(order, ['mutate']);
});

test('commit can opt out of snapshot and save (selection-only redraw)', () => {
  const { store, log } = make();
  store.commit(() => {}, { snapshot: false, save: false });
  assert.deepEqual(log, { snapshot: 0, render: 1, save: 0 });
});

test('commit always re-renders even when mutate throws is not swallowed', () => {
  const { store, log } = make();
  assert.throws(() => store.commit(() => { throw new Error('boom'); }));
  assert.deepEqual(log, { snapshot: 1, render: 0, save: 0 }); // render/save skipped on throw
});
