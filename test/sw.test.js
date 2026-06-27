'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

test('service worker precaches the app shell + engine', () => {
  assert.match(sw, /'\.\/index\.html'/);
  assert.match(sw, /'\.\/styles\.css'/);
  assert.match(sw, /'\.\/app\.js'/);
  assert.match(sw, /'\.\/state\.js'/);
  assert.match(sw, /'\.\/engine\.js'/); // forgetting this would silently break offline mode
  assert.match(sw, /'\.\/render\.js'/);
  assert.match(sw, /'\.\/interactions\.js'/);
  assert.match(sw, /'\.\/canvases\.js'/);
  assert.match(sw, /'\.\/editing\.js'/);
  assert.match(sw, /'\.\/input\.js'/);
  assert.match(sw, /'\.\/history\.js'/);
  assert.match(sw, /'\.\/store\.js'/);
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

test('asset revision matches the precached app shell contents', () => {
  const revision = /const ASSET_REVISION = '([0-9a-f]+)'/.exec(sw);
  assert.ok(revision, 'ASSET_REVISION is missing');
  const assetList = /const ASSETS = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(assetList, 'ASSETS list is missing');

  const assets = Array.from(assetList[1].matchAll(/'([^']+)'/g))
    .map((match) => match[1])
    .filter((asset) => asset !== './' && asset !== './sw.js');
  const hash = crypto.createHash('sha256');
  assets.forEach((asset) => {
    hash.update(asset + '\0');
    hash.update(fs.readFileSync(path.join(__dirname, '..', asset.replace(/^\.\//, ''))));
    hash.update('\0');
  });
  assert.equal(revision[1], hash.digest('hex').slice(0, revision[1].length));
});
