const { test, expect } = require('@playwright/test');
const { fresh, press, type, lastBlock, addBlock } = require('./helpers');

// The app is an offline-capable PWA: once the service worker has cached the
// shell, a reload with no network should still boot and compute.
test('the app still loads and computes offline after the SW caches it', async ({ page, context }) => {
  await fresh(page);
  // Wait until the service worker is actually controlling the page (so the
  // precache has been populated by its install step).
  await page.waitForFunction(() => navigator.serviceWorker && !!navigator.serviceWorker.controller);

  await context.setOffline(true);
  try {
    await page.reload();
    await page.waitForSelector('.padgrid .key[data-k="("]'); // UI booted from cache
    await addBlock(page);
    await type(page, '2 + 3');
    await press(page, '=');
    await expect(lastBlock(page).locator('.result')).toHaveText('5');
  } finally {
    await context.setOffline(false);
  }
});
