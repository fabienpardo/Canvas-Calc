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

test('mobile: tapping a finished result selects it without focusing its caption', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '6 * 7');
  await press(page, '=');

  await lastBlock(page).locator('.result').tap();

  await expect(lastBlock(page)).toHaveClass(/selected/);
  await expect(lastBlock(page).locator('.result')).toHaveClass(/sel/);
  await expect.poll(async () => page.evaluate(() => {
    const ae = document.activeElement;
    return !!ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
  })).toBe(false);
  await expect.poll(async () => page.evaluate(() =>
    document.documentElement.classList.contains('text-editing')
  )).toBe(false);
  await expect(page.locator('#numpad')).not.toHaveClass(/hidden/);
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

test('mobile: tapping a populated block body abandons an empty draft', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5 + 0');
  await press(page, '=');

  const populated = page.locator('.block').first();
  await page.locator('#addBtn').tap();
  await expect(page.locator('.block.empty-draft')).toBeVisible();

  const box = await populated.boundingBox();
  // Use the same exact background point as the block long-press regression;
  // touch hit-target adjustment can otherwise redirect a tiny inset to a term.
  await page.mouse.click(box.x + 6, box.y + 6);

  await expect(page.locator('.block.empty-draft')).toHaveCount(0);
  await expect(page.locator('.block')).toHaveCount(1);
  await expect(populated).toHaveClass(/selected/);
});

test('mobile: returning from a caption to its block clears text-entry focus', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5 + 0');
  await press(page, '=');
  const block = lastBlock(page);
  await block.click({ position: { x: 6, y: 6 } });
  const caption = block.locator('.result-cell .cap');
  await caption.click();
  await page.keyboard.type('Total');
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.classList.contains('text-editing')
  )).toBe(true);

  const box = await block.boundingBox();
  await page.mouse.click(box.x + 6, box.y + 6);

  await expect(caption).toHaveText('Total');
  await expect.poll(() => page.evaluate(() => {
    const active = document.activeElement;
    return document.documentElement.classList.contains('text-editing') ||
      !!(active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'));
  })).toBe(false);
  await expect(page.locator('#numpad')).not.toHaveClass(/hidden/);
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

test('mobile: short landscape side-docks a fully reachable keypad beside useful canvas space', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await fresh(page);

  const pad = await page.locator('#numpad').boundingBox();
  const toggle = page.locator('#padToggle');
  const toggleBox = await toggle.boundingBox();
  const toolbar = await page.locator('#toolbar').boundingBox();
  expect(pad.x).toBeGreaterThan(300);
  expect(pad.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height - 1);
  expect(pad.y + pad.height).toBeLessThanOrEqual(375);
  expect(pad.x).toBeGreaterThanOrEqual(667 * 0.45);
  const zoom = await page.locator('#zoomCtl').boundingBox();
  expect(zoom.x + zoom.width).toBeLessThan(pad.x);
  expect(zoom.y + zoom.height).toBeLessThanOrEqual(375);

  const keys = await page.locator('.padgrid .key').evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }));
  expect(keys).toHaveLength(20);
  for (const key of keys) {
    expect(key.left).toBeGreaterThanOrEqual(0);
    expect(key.top).toBeGreaterThanOrEqual(0);
    expect(key.right).toBeLessThanOrEqual(667);
    expect(key.bottom).toBeLessThanOrEqual(375);
    expect(key.width).toBeGreaterThanOrEqual(44);
    expect(key.height).toBeGreaterThanOrEqual(40);
  }

  const hint = await page.locator('.hint-mark').boundingBox();
  expect(hint.x + hint.width).toBeLessThanOrEqual(toggleBox.x);
  await page.touchscreen.tap(hint.x + hint.width / 2, hint.y + hint.height / 2);
  await expect(page.locator('.block')).toHaveCount(1);
  await expect(page.locator('#numpad')).not.toHaveClass(/hidden/);
  await press(page, '7');
  await press(page, '+');
  await press(page, '1');
  await press(page, '=');
  await expect(page.locator('.block').last().locator('.result')).toHaveText('8');

  await toggle.click();
  await expect(page.locator('#numpad')).toHaveClass(/hidden/);
  await expect(toggle).toBeInViewport();
  await toggle.click();
  await expect(page.locator('#numpad')).not.toHaveClass(/hidden/);
});

test('mobile: short landscape keeps long input and Done inside the left canvas pane', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await fresh(page);
  await addBlock(page);
  await type(page, Array.from({ length: 16 }, () => '1 +').join(' ') + ' 1');

  const wrap = await page.locator('#canvasWrap').boundingBox();
  const toggle = await page.locator('#padToggle').boundingBox();
  const inSafePane = async (locator) => {
    const box = await locator.boundingBox();
    return !!box &&
      box.x >= wrap.x + 17 && box.x + box.width <= toggle.x - 17 &&
      box.y >= wrap.y + 17 && box.y + box.height <= wrap.y + wrap.height - 17;
  };
  await expect.poll(() => inSafePane(lastBlock(page).locator('.expr-caret'))).toBe(true);

  await press(page, '=');
  await expect(lastBlock(page).locator('.result')).toHaveText('17');
  await expect.poll(() => inSafePane(lastBlock(page).locator('.result'))).toBe(true);
});

test('mobile: a long canvas list stays bounded and keeps every action reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  const canvases = Array.from({ length: 15 }, (_, i) => ({
    id: `c${i + 1}`, title: `Canvas ${i + 1}`, nextId: 1, nextTid: 1,
    zoom: 1, blocks: []
  }));
  await seed(page, {
    canvases, activeCanvasId: 'c15', nextCanvasId: 16,
    fontSize: 22, showGrid: false
  });

  await page.locator('#canvasBtn').click();
  const menu = page.locator('#canvasMenu');
  const metrics = await menu.evaluate((el) => ({
    overflowY: getComputedStyle(el).overflowY,
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    bottom: el.getBoundingClientRect().bottom
  }));
  expect(metrics.overflowY).toBe('auto');
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(metrics.bottom).toBeLessThanOrEqual(664);
  await expect(menu.locator('.cv-row.active')).toBeInViewport();

  const add = menu.locator('.cv-new');
  await add.scrollIntoViewIfNeeded();
  await expect(add).toBeInViewport();
  await add.click();
  await expect(page.locator('#canvasName')).toHaveText('Canvas 16');
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
  const capBox = await titleCap.boundingBox();
  const blockBox = await lastBlock(page).boundingBox();
  const resultBox = await lastBlock(page).locator('.result').boundingBox();
  expect(capBox.width).toBeLessThanOrEqual(170);
  expect(capBox.x).toBeGreaterThanOrEqual(blockBox.x - 1);
  expect(capBox.x + capBox.width).toBeLessThanOrEqual(blockBox.x + blockBox.width + 1);
  expect(capBox.y + capBox.height).toBeLessThanOrEqual(resultBox.y - 1);

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

test('mobile: closing sidebar blurs focused sidebar inputs', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5 + 0');
  await press(page, '=');

  await page.locator('#varsBtn').click();
  const name = page.locator('#sidebarBody .var-head .var-name').first();
  await name.focus();
  await page.keyboard.type('Budget');
  await expect.poll(async () => page.evaluate(() => document.documentElement.classList.contains('text-editing'))).toBe(true);

  await page.locator('#sidebarClose').evaluate((el) => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });

  await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
  await expect.poll(async () => page.evaluate(() => document.documentElement.classList.contains('text-editing'))).toBe(false);
  await expect.poll(async () => page.evaluate(() => {
    const ae = document.activeElement;
    return !!ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
  })).toBe(false);
});

test('mobile: closed sidebar and hidden keypad are inert', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5 + 0');
  await press(page, '=');

  await page.locator('#varsBtn').click();
  await expect.poll(() => page.evaluate(() => document.getElementById('sidebar').inert)).toBe(false);
  await page.locator('#sidebarClose').click();

  await expect(page.locator('#numpad')).toHaveClass(/hidden/);
  await expect.poll(() => page.evaluate(() => ({
    sidebar: document.getElementById('sidebar').inert,
    keypad: document.querySelector('.padgrid').inert,
    keypadHidden: document.querySelector('.padgrid').getAttribute('aria-hidden')
  }))).toEqual({ sidebar: true, keypad: true, keypadHidden: 'true' });
});

test('mobile: closing a dialog does not restore text-entry focus', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5 + 0');
  await press(page, '=');

  await page.locator('#varsBtn').click();
  const name = page.locator('#sidebarBody .var-head .var-name').first();
  await name.focus();
  await page.keyboard.type('Budget');
  await expect.poll(async () => page.evaluate(() => document.documentElement.classList.contains('text-editing'))).toBe(true);

  await page.locator('#clearBtn').evaluate((el) => el.click());
  await expect(page.locator('#toast')).toBeVisible();
  await page.locator('#toastRow button', { hasText: 'Cancel' }).click();

  await expect(page.locator('#toast')).toBeHidden();
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
  await expect(name).toHaveValue('Budget');
  await expect.poll(async () => page.evaluate(() => document.documentElement.classList.contains('text-editing'))).toBe(false);
  await expect.poll(async () => page.evaluate(() => {
    const ae = document.activeElement;
    return !!ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
  })).toBe(false);
});

test('mobile: opening canvas menu does not autofocus rename', async ({ page }) => {
  await fresh(page);

  await page.locator('#canvasBtn').click();

  await expect(page.locator('#canvasMenu')).toBeVisible();
  await expect(page.locator('#canvasMenu input.cv-name')).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => document.documentElement.classList.contains('text-editing'))).toBe(false);
  await expect.poll(async () => page.evaluate(() => {
    const ae = document.activeElement;
    return !!ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
  })).toBe(false);
});

test('mobile: closing canvas menu blurs the rename input', async ({ page }) => {
  await fresh(page);

  await page.locator('#canvasBtn').click();
  await page.locator('#canvasMenu .cv-row.active button.cv-name').click();
  const name = page.locator('#canvasMenu input.cv-name');
  await page.keyboard.type(' Plan');
  await expect.poll(async () => page.evaluate(() => document.documentElement.classList.contains('text-editing'))).toBe(true);

  await page.evaluate(() => {
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  });

  await expect(page.locator('#canvasMenu')).toBeHidden();
  await expect.poll(async () => page.evaluate(() => document.documentElement.classList.contains('text-editing'))).toBe(false);
  await expect.poll(async () => page.evaluate(() => {
    const ae = document.activeElement;
    return !!ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
  })).toBe(false);
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

test('mobile: selecting a linked chip reveals block delete without a caret or block outline', async ({ page }) => {
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
  await expect(linkedBlock).toHaveClass(/has-selection/);
  await expect(linkedBlock.locator('.term.linked')).toHaveClass(/sel/);
  await expect(linkedBlock.locator('.selection-caret')).toHaveCount(0);
  await expect(linkedBlock.locator('.block-del')).toBeVisible();

  await linkedBlock.locator('.block-del').click();
  await expect(page.locator('.block')).toHaveCount(1);
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
