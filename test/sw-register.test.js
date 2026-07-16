'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sw-register.js'), 'utf8');

function runRegistration(hasController) {
  const windowListeners = {};
  const workerListeners = {};
  let registrations = 0;
  let reloads = 0;
  const context = {
    navigator: {
      serviceWorker: {
        controller: hasController ? {} : null,
        addEventListener(type, handler) { workerListeners[type] = handler; },
        register() {
          registrations += 1;
          return Promise.resolve();
        }
      }
    },
    window: {
      addEventListener(type, handler) { windowListeners[type] = handler; },
      location: { reload() { reloads += 1; } }
    }
  };
  vm.runInNewContext(source, context);
  return {
    windowListeners,
    workerListeners,
    registrations: () => registrations,
    reloads: () => reloads
  };
}

test('service worker registers after window load', async () => {
  const run = runRegistration(false);
  assert.equal(typeof run.windowListeners.load, 'function');
  assert.equal(run.workerListeners.controllerchange, undefined);
  run.windowListeners.load();
  await Promise.resolve();
  assert.equal(run.registrations(), 1);
  assert.equal(run.reloads(), 0);
});

test('an upgraded controller reloads an existing app shell only once', () => {
  const run = runRegistration(true);
  assert.equal(typeof run.workerListeners.controllerchange, 'function');
  run.workerListeners.controllerchange();
  run.workerListeners.controllerchange();
  assert.equal(run.reloads(), 1);
});
