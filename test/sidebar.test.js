'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Sidebar = require('../sidebar.js');

test('normalizeSidebarNumber accepts strict plain and localized numbers', () => {
  assert.equal(Sidebar.normalizeSidebarNumber('1234', ',', '.'), '1234');
  assert.equal(Sidebar.normalizeSidebarNumber('1,234.50', ',', '.'), '1234.50');
  assert.equal(Sidebar.normalizeSidebarNumber('.5', ',', '.'), '0.5');
  assert.equal(Sidebar.normalizeSidebarNumber('-.5', ',', '.'), '-0.5');
  assert.equal(Sidebar.normalizeSidebarNumber('1.234,50', '.', ','), '1234.50');
});

test('normalizeSidebarNumber rejects malformed sidebar values', () => {
  assert.equal(Sidebar.normalizeSidebarNumber('12abc', ',', '.'), null);
  assert.equal(Sidebar.normalizeSidebarNumber('1..2', ',', '.'), null);
  assert.equal(Sidebar.normalizeSidebarNumber('1,23', ',', '.'), null);
  assert.equal(Sidebar.normalizeSidebarNumber('-', ',', '.'), null);
  assert.equal(Sidebar.normalizeSidebarNumber('', ',', '.'), null);
});
