'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const History = require('../history.js');

// Minimal harness: a single active canvas plus fake undo/redo buttons.
function harness() {
  const canvas = { id: 'c1', blocks: [], nextId: 1, nextTid: 1 };
  const env = {
    activeCanvasId: 'c1',
    activeBlockId: 'b9',
    selectionCleared: 0,
    renders: 0,
    saves: 0,
    undoBtn: { disabled: false },
    redoBtn: { disabled: false }
  };
  const ctl = History.create({
    cur: () => canvas,
    getActiveCanvasId: () => env.activeCanvasId,
    clearSelection: () => { env.selectionCleared++; },
    setActiveBlockId: (id) => { env.activeBlockId = id; },
    renderAll: () => { env.renders++; },
    save: () => { env.saves++; },
    undoBtn: env.undoBtn,
    redoBtn: env.redoBtn
  });
  return { ctl, canvas, env };
}

test('snapshot enables undo and clears the redo stack', () => {
  const h = harness();
  assert.equal(h.env.undoBtn.disabled, false); // not yet recomputed
  h.canvas.blocks.push({ id: 'b1' });
  h.ctl.snapshot();
  assert.equal(h.env.undoBtn.disabled, false); // a step exists
  assert.equal(h.env.redoBtn.disabled, true);  // nothing to redo
});

test('undo restores the previous snapshot and re-enables redo', () => {
  const h = harness();
  h.ctl.snapshot();              // capture empty state
  h.canvas.blocks.push({ id: 'b1' }); // mutate after snapshot
  assert.equal(h.canvas.blocks.length, 1);

  h.ctl.undo();
  assert.equal(h.canvas.blocks.length, 0); // reverted
  assert.equal(h.env.activeBlockId, null); // cleared
  assert.equal(h.env.renders, 1);
  assert.equal(h.env.saves, 1);
  assert.equal(h.env.redoBtn.disabled, false);
  assert.equal(h.env.undoBtn.disabled, true);
});

test('redo re-applies an undone change', () => {
  const h = harness();
  h.ctl.snapshot();
  h.canvas.blocks.push({ id: 'b1' });
  h.ctl.undo();
  assert.equal(h.canvas.blocks.length, 0);

  h.ctl.redo();
  assert.equal(h.canvas.blocks.length, 1);
  assert.equal(h.canvas.blocks[0].id, 'b1');
  assert.equal(h.env.redoBtn.disabled, true);
});

test('undo/redo are no-ops on empty stacks', () => {
  const h = harness();
  h.ctl.undo();
  h.ctl.redo();
  assert.equal(h.env.renders, 0);
  assert.equal(h.env.saves, 0);
});

test('stacks are isolated per canvas id', () => {
  const h = harness();
  h.ctl.snapshot();                 // step on c1
  h.env.activeCanvasId = 'c2';      // switch canvas
  h.ctl.updateButtons();
  assert.equal(h.env.undoBtn.disabled, true); // c2 has no history

  h.ctl.deleteStack('c1');
  h.env.activeCanvasId = 'c1';
  h.ctl.updateButtons();
  assert.equal(h.env.undoBtn.disabled, true); // c1 stack was dropped
});
