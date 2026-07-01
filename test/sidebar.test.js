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

test('selected block health summarizes links and neighbours', () => {
  const sourceA = { id: 'a', label: 'Revenue', terms: [] };
  const sourceB = { id: 'b', label: 'Tax', terms: [] };
  const selected = { id: 'c', label: '', terms: [
    { type: 'linked', sourceId: 'a' },
    { type: 'operator', value: '+' },
    { type: 'linked', sourceId: 'b' },
    { type: 'operator', value: '+' },
    { type: 'linked', sourceId: 'a' }
  ] };
  const dependent = { id: 'd', label: '', terms: [{ type: 'linked', sourceId: 'c' }] };
  const blocks = [sourceA, sourceB, selected, dependent];

  const health = Sidebar.collectBlockHealth(
    selected,
    blocks,
    {},
    () => ({ status: 'ok', value: 12, reason: null, message: '' }),
    String
  );

  assert.equal(health.title, 'Block c');
  assert.equal(health.statusText, 'Resolved · 12');
  assert.equal(health.linkCount, 3);
  assert.deepEqual(health.uses.map((item) => item.label), ['Revenue', 'Tax']);
  assert.deepEqual(health.usedBy.map((item) => item.label), ['Block d']);
});

test('selected block health reports unresolved source reasons', () => {
  const selected = { id: 'b', label: 'Total', terms: [{ type: 'linked', sourceId: 'a' }] };
  const health = Sidebar.collectBlockHealth(
    selected,
    [selected],
    {},
    () => ({ status: 'unresolved', value: null, reason: 'source-unresolved', message: 'Fix the linked source first.' }),
    String
  );

  assert.equal(health.status, 'unresolved');
  assert.equal(health.statusText, 'Unresolved');
  assert.equal(health.reason, 'Fix the linked source first.');
});
