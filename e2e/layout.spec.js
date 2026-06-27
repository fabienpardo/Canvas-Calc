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
});

test('desktop keypad is compact and does not cover the left zoom control', async ({ page }) => {
  await fresh(page);
  const vw = page.viewportSize().width;
  const pad = await page.locator('#numpad').boundingBox();
  expect(pad.width).toBeLessThanOrEqual(380);
  expect(pad.x + pad.width).toBeLessThanOrEqual(vw - 8);
  const zc = await page.locator('#zoomCtl').boundingBox();
  expect(zc.x + zc.width).toBeLessThan(pad.x);
});

test('desktop keypad shifts left when variables sidebar is open', async ({ page }) => {
  await fresh(page);
  await page.locator('#varsBtn').click();
  const pad = await page.locator('#numpad').boundingBox();
  const sidebar = await page.locator('#sidebar').boundingBox();
  expect(pad.x + pad.width).toBeLessThanOrEqual(sidebar.x - 8);
  await expect(page.locator('#varsBtn')).toHaveAttribute('aria-pressed', 'true');
});
