const { test, expect } = require('@playwright/test');
const { fresh, press, type, lastBlock, addBlock } = require('./helpers');

// Primary mobile target: iPhone 16 Pro Max in portrait (about 440 CSS px wide).
test.use({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

test('mobile: create a block and evaluate', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '6 * 7');
  await expect(lastBlock(page).locator('.result')).toHaveText('42');
});

test('mobile: keypad and add button fit within the viewport width', async ({ page }) => {
  await fresh(page);
  const vw = page.viewportSize().width;
  const pad = await page.locator('#numpad').boundingBox();
  const eq = await page.locator('.key.eq').boundingBox();
  const padBottom = await page.locator('#numpad').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
  const bottomGap = pad.y + pad.height - (eq.y + eq.height);
  expect(pad.x).toBeGreaterThanOrEqual(0);
  expect(pad.x + pad.width).toBeLessThanOrEqual(vw + 1);
  expect(pad.height).toBeLessThanOrEqual(page.viewportSize().height * 0.34);
  expect(bottomGap).toBeLessThanOrEqual(Math.max(32, padBottom + 6));
});
