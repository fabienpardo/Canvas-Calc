'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Renderer = require('../render.js');

test('normalizeSidebarNumber accepts strict plain and localized numbers', () => {
  assert.equal(Renderer.normalizeSidebarNumber('1234', ',', '.'), '1234');
  assert.equal(Renderer.normalizeSidebarNumber('1,234.50', ',', '.'), '1234.50');
  assert.equal(Renderer.normalizeSidebarNumber('.5', ',', '.'), '0.5');
  assert.equal(Renderer.normalizeSidebarNumber('-.5', ',', '.'), '-0.5');
  assert.equal(Renderer.normalizeSidebarNumber('1.234,50', '.', ','), '1234.50');
});

test('normalizeSidebarNumber rejects malformed sidebar values', () => {
  assert.equal(Renderer.normalizeSidebarNumber('12abc', ',', '.'), null);
  assert.equal(Renderer.normalizeSidebarNumber('1..2', ',', '.'), null);
  assert.equal(Renderer.normalizeSidebarNumber('1,23', ',', '.'), null);
  assert.equal(Renderer.normalizeSidebarNumber('-', ',', '.'), null);
  assert.equal(Renderer.normalizeSidebarNumber('', ',', '.'), null);
});
