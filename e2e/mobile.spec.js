const { test, expect, devices } = require('@playwright/test');
const { fresh, press, type, lastBlock } = require('./helpers');

// Run this file under a mobile (touch, narrow-viewport) profile.
test.use({ ...devices['Pixel 7'] });

test('mobile: create a block and evaluate', async ({ page }) => {
  await fresh(page);
  await page.locator('#addBtn').click();
  await type(page, '6 * 7');
  await expect(lastBlock(page).locator('.result')).toHaveText('42');
});

test('mobile: keypad and add button fit within the viewport width', async ({ page }) => {
  await fresh(page);
  const vw = page.viewportSize().width;
  const pad = await page.locator('#numpad').boundingBox();
  expect(pad.x).toBeGreaterThanOrEqual(0);
  expect(pad.x + pad.width).toBeLessThanOrEqual(vw + 1);
});
