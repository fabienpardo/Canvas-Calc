'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

test('service worker precaches the app shell + engine', () => {
  assert.match(sw, /'\.\/index\.html'/);
  assert.match(sw, /'\.\/state\.js'/);
  assert.match(sw, /'\.\/engine\.js'/); // forgetting this would silently break offline mode
  assert.match(sw, /'\.\/render\.js'/);
  assert.match(sw, /'\.\/interactions\.js'/);
  assert.match(sw, /'\.\/canvases\.js'/);
  assert.match(sw, /'\.\/editing\.js'/);
  assert.match(sw, /'\.\/input\.js'/);
  assert.match(sw, /'\.\/history\.js'/);
  assert.match(sw, /'\.\/manifest\.webmanifest'/);
});

test('runtime caching only stores successful responses', () => {
  assert.match(sw, /res\.ok/);
});

test('non-GET requests are not intercepted', () => {
  assert.match(sw, /method !== 'GET'/);
});

test('old caches are cleaned on activate', () => {
  assert.match(sw, /caches\.delete/);
});
