const { test, expect } = require('@playwright/test');
const { fresh, press, type, lastBlock, seed, addBlock } = require('./helpers');

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
  await type(page, '5 + 0');
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

test('mobile: keypad fits within the viewport width', async ({ page }) => {
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

test('mobile: opening sidebar blurs text editing and hides the keypad', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5 + 0');
  await press(page, '=');
  await lastBlock(page).click({ position: { x: 6, y: 6 } });
  const titleCap = lastBlock(page).locator('.result-cell .cap');
  await titleCap.click();
  await page.keyboard.type('Total');
  await expect.poll(async () => page.evaluate(() => document.documentElement.classList.contains('text-editing'))).toBe(true);

  await page.locator('#varsBtn').click();

  await expect(page.locator('#sidebar')).toHaveClass(/open/);
  await expect(page.locator('#numpad')).toHaveClass(/hidden/);
  await expect.poll(async () => page.evaluate(() => document.documentElement.classList.contains('text-editing'))).toBe(false);
  await expect.poll(async () => page.evaluate(() => {
    const ae = document.activeElement;
    return !!ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
  })).toBe(false);
  await expect(lastBlock(page).locator('.result-cell .cap')).toHaveText('Total');
});

test('mobile: Done minimally reveals a clipped result', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  const parts = [];
  for (let i = 0; i < 30; i++) parts.push('1', '+');
  parts.push('1');
  await type(page, parts.join(' '));
  await page.locator('#canvasWrap').evaluate((el) => { el.scrollLeft = 0; });

  await press(page, '=');

  await expect.poll(async () => {
    const result = await lastBlock(page).locator('.result').boundingBox();
    const wrap = await page.locator('#canvasWrap').boundingBox();
    const pad = await page.locator('#numpad').boundingBox();
    return !!result && !!wrap && !!pad &&
      result.x >= wrap.x + 12 &&
      result.x + result.width <= wrap.x + wrap.width - 12 &&
      result.y + result.height <= pad.y - 12;
  }).toBe(true);
});

test('mobile: selecting a linked chip has no caret and no active block outline', async ({ page }) => {
  await seed(page, {
    canvases: [{
      id: 'c1',
      title: 'Canvas 1',
      blocks: [
        { id: 'b1', x: 40, y: 30, label: '', terms: [{ type: 'number', value: '5', tid: 't1' }] },
        { id: 'b2', x: 40, y: 130, label: '', terms: [{ type: 'linked', sourceId: 'b1' }] }
      ],
      nextId: 3,
      nextTid: 2,
      zoom: 1
    }],
    activeCanvasId: 'c1',
    nextCanvasId: 2,
    fontSize: 22,
    showGrid: false
  });

  const linkedBlock = page.locator('.block').nth(1);
  await linkedBlock.locator('.term.linked').click();

  await expect(linkedBlock).not.toHaveClass(/active/);
  await expect(linkedBlock).not.toHaveClass(/selected/);
  await expect(linkedBlock.locator('.term.linked')).toHaveClass(/sel/);
  await expect(linkedBlock.locator('.selection-caret')).toHaveCount(0);
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
