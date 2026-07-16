'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Renderer = require('../render');

test('link color indices are stable across traversal order and unrelated deletion', () => {
  const keys = ['b1|@result', 'b2|t3', 'b8|@result', 'b12|t20'];
  const original = Object.fromEntries(keys.map((key) => [key, Renderer.colorIndexForSource(key)]));

  keys.slice().reverse().forEach((key) => {
    assert.equal(Renderer.colorIndexForSource(key), original[key]);
  });
  keys.slice(1).forEach((key) => {
    assert.equal(Renderer.colorIndexForSource(key), original[key]);
  });
});

test('link color indices stay inside the CSS palette range', () => {
  for (let i = 1; i <= 100; i++) {
    const index = Renderer.colorIndexForSource(`b${i}|${i % 2 ? '@result' : `t${i}`}`);
    assert.ok(index >= 0 && index < 8);
  }
});
