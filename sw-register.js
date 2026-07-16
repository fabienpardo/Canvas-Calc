/* Canvas Calc - service-worker registration and upgrade handoff. */
(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  // An existing controller means this page may have been loaded while an older
  // app shell was active. When the new worker claims the page, reload once so
  // HTML, CSS, and JavaScript all come from the same revision.
  var hadController = !!navigator.serviceWorker.controller;
  var reloading = false;
  if (hadController) {
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
})();
