const { test, expect } = require('@playwright/test');
const { fresh } = require('./helpers');

test('the zoom control is pinned (does not scroll with the canvas)', async ({ page }) => {
  await fresh(page);
  const zc = page.locator('#zoomCtl');
  const before = await zc.boundingBox();
  await page.locator('#canvasWrap').evaluate((el) => { el.scrollTop = 300; el.scrollLeft = 200; });
  const after = await zc.boundingBox();
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
});

test('the canvas extends behind the keypad (keypad is an overlay)', async ({ page }) => {
  await fresh(page);
  const wrap = await page.locator('#canvasWrap').boundingBox();
  const pad = await page.locator('#numpad').boundingBox();
  // the canvas viewport reaches at/below the top of the keypad, so content can sit behind it
  expect(wrap.y + wrap.height).toBeGreaterThan(pad.y + 5);
  // and the zoom control stays above the keypad
  const zc = await page.locator('#zoomCtl').boundingBox();
  expect(zc.y + zc.height).toBeLessThanOrEqual(pad.y + 1);
});
