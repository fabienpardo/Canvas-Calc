const { test, expect } = require('@playwright/test');
const { fresh, press, type, lastBlock, addBlock } = require('./helpers');

// Primary mobile target: iPhone 16 Pro Max in portrait (about 440 CSS px wide).
test.use({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

async function touchDragToPoint(page, source, tx, ty, beforeEnd) {
  const box = await source.boundingBox();
  const sx = box.x + box.width / 2;
  const sy = box.y + box.height / 2;
  const client = await page.context().newCDPSession(page);

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: sx, y: sy, radiusX: 3, radiusY: 3, id: 1 }],
  });
  for (let i = 1; i <= 12; i++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: sx + ((tx - sx) * i) / 12,
        y: sy + ((ty - sy) * i) / 12,
        radiusX: 3,
        radiusY: 3,
        id: 1,
      }],
    });
    await page.waitForTimeout(16);
  }
  if (beforeEnd) await beforeEnd();
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

test('mobile: create a block and evaluate', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '6 * 7');
  await expect(lastBlock(page).locator('.result')).toHaveText('42');
});

test('mobile: long-press on a block reveals its delete control, never deletes', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5');
  await press(page, '=');
  const b = lastBlock(page);
  const bb = await b.boundingBox();
  // Stationary hold on the block background, well past the 550ms threshold.
  await page.mouse.move(bb.x + 6, bb.y + 6);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await expect(page.locator('.block')).toHaveCount(1);   // the hold must not delete
  await expect(b.locator('.block-del')).toBeVisible();    // actions are revealed instead
  await page.mouse.up();
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

test('mobile: long expression input follows the caret above the keypad', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  const parts = [];
  for (let i = 0; i < 36; i++) parts.push('1', '+');
  parts.push('1');
  await type(page, parts.join(' '));
  await expect.poll(async () => {
    const caret = await lastBlock(page).locator('.expr-caret').boundingBox();
    const pad = await page.locator('#numpad').boundingBox();
    const viewport = page.viewportSize();
    const scrolled = await page.locator('#canvasWrap').evaluate((el) => el.scrollLeft + el.scrollTop);
    return !!caret && !!pad && scrolled > 0 &&
      caret.x > 12 &&
      caret.x + caret.width < viewport.width - 12 &&
      caret.y + caret.height < pad.y - 12;
  }).toBe(true);

  const caret = await lastBlock(page).locator('.expr-caret').boundingBox();
  const pad = await page.locator('#numpad').boundingBox();
  expect(caret).not.toBeNull();
  expect(pad).not.toBeNull();
  expect(caret.x).toBeGreaterThan(12);
  expect(caret.x + caret.width).toBeLessThan(page.viewportSize().width - 12);
  expect(caret.y + caret.height).toBeLessThan(pad.y - 12);
});

test('mobile: dropping with the finger below the preview inserts at the visible target', async ({ page, browserName }) => {
  // touchDragToPoint drives synthetic touches via CDP, which is Chromium-only.
  test.skip(browserName !== 'chromium', 'touch-drag helper uses Chromium-only CDP touch events');
  await fresh(page);
  await addBlock(page);
  await type(page, '5 + 8 ( 2 . 1 + 5');
  await page.locator('#canvas').click({ position: { x: 360, y: 360 } });
  await expect(lastBlock(page).locator('.result')).toHaveText('61.8');

  await press(page, '+');
  await press(page, '5');
  const targetBlock = page.locator('.block').nth(1);
  await expect(targetBlock.locator('.expr .term')).toHaveText(['61.8', '+', '5']);

  const source = page.locator('.block').first().locator('.term.number', { hasText: '8' });
  const linked = targetBlock.locator('.term.linked', { hasText: '61.8' });
  const box = await linked.boundingBox();
  await touchDragToPoint(page, source, box.x - 8, box.y + box.height / 2 + 48, async () => {
    await expect(targetBlock).toHaveClass(/drop-ok/);
    await expect(targetBlock.locator('.drop-caret')).toHaveCount(1);
  });

  await expect(targetBlock.locator('.expr .term')).toHaveText(['8', '+', '61.8', '+', '5']);
  await expect(targetBlock.locator('.result')).toHaveText('74.8');
});
