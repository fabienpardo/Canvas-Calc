'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../state.js');

test('normalizeState creates a default canvas when state is missing', () => {
  const state = S.normalizeState(null);
  assert.equal(state.canvases.length, 1);
  assert.equal(state.activeCanvasId, 'c1');
  assert.equal(state.fontSize, 22);
  assert.equal(state.showGrid, false);
});

test('normalizeState migrates the old single-canvas shape', () => {
  const state = S.normalizeState({
    blocks: [{ id: 'b1', x: 60, y: 60, terms: [{ type: 'number', value: '6' }] }],
    nextId: 2,
    fontSize: 28,
    showGrid: true
  });
  assert.equal(state.canvases.length, 1);
  assert.equal(state.canvases[0].title, 'Canvas 1');
  assert.equal(state.canvases[0].blocks[0].terms[0].tid, 't1');
  assert.equal(state.fontSize, 28);
  assert.equal(state.showGrid, true);
});

test('normalizeState drops malformed objects and coerces number terms', () => {
  const state = S.normalizeState({
    canvases: [{ id: 'c1', blocks: [
      null,
      { id: 'b1', x: NaN, y: 'bad', label: 123, terms: [
        { type: 'number', value: 1234, label: 42 },
        { type: 'operator', value: '%' },
        { type: 'operator', value: '+' },
        { type: 'paren', value: '[' },
        { type: 'paren', value: '(' },
        { type: 'linked', sourceId: 99 },
        { type: 'linked', sourceId: 'b2', sourceTid: 7 }
      ] }
    ] }],
    activeCanvasId: 'c1'
  });
  const block = state.canvases[0].blocks[0];
  assert.equal(block.x, 40);
  assert.equal(block.y, 30);
  assert.equal(block.label, '');
  assert.deepEqual(block.terms.map((t) => t.type), ['number', 'operator', 'paren', 'linked']);
  assert.equal(block.terms[0].value, '1234');
  assert.equal(block.terms[0].label, '');
  assert.equal(block.terms[3].sourceTid, '7');
});

test('normalizeState advances stale and duplicate ids', () => {
  const state = S.normalizeState({
    canvases: [
      { id: 'c1', nextId: 1, nextTid: 1, blocks: [
        { id: 'b5', terms: [{ type: 'number', value: '1', tid: 't7' }] },
        { id: 'b5', terms: [{ type: 'number', value: '2', tid: 't7' }] }
      ] },
      { id: 'c1', blocks: [] }
    ],
    activeCanvasId: 'missing',
    nextCanvasId: 1
  });
  assert.deepEqual(state.canvases.map((c) => c.id), ['c1', 'c2']);
  assert.deepEqual(state.canvases[0].blocks.map((b) => b.id), ['b5', 'b6']);
  assert.deepEqual(state.canvases[0].blocks.map((b) => b.terms[0].tid), ['t7', 't8']);
  assert.equal(state.canvases[0].nextId, 7);
  assert.equal(state.canvases[0].nextTid, 9);
  assert.equal(state.nextCanvasId, 3);
  assert.equal(state.activeCanvasId, 'c1');
});

test('byId and blocksMap use the active canvas data shape', () => {
  const canvas = S.normalizeState({
    canvases: [{ id: 'c1', blocks: [{ id: 'b1', terms: [] }, { id: 'b2', terms: [] }] }]
  }).canvases[0];
  assert.equal(S.byId(canvas, 'b2').id, 'b2');
  assert.equal(S.byId(canvas, 'gone'), null);
  assert.deepEqual(Object.keys(S.blocksMap(canvas)), ['b1', 'b2']);
});
