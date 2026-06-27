const { test, expect } = require('@playwright/test');
const { seed, lastBlock } = require('./helpers');

// An "old" saved state: number terms with no tid, and no zoom/showGrid/nextTid/fontSize.
const OLD_STATE = {
  blocks: [{ id: 'b1', x: 60, y: 60, label: '', terms: [
    { type: 'number', value: '6' }, { type: 'operator', value: '*' }, { type: 'number', value: '7' }
  ] }],
  nextId: 2
};

test('loads an old saved state and computes correctly', async ({ page }) => {
  await seed(page, OLD_STATE);
  await expect(lastBlock(page).locator('.result')).toHaveText('42');
});

test('migration assigns tids so old numbers can still be linked', async ({ page }) => {
  await seed(page, OLD_STATE);
  // drag the "6" to empty canvas — this only works if a tid was assigned on load
  const chip = lastBlock(page).locator('.term.number', { hasText: '6' });
  const b = await chip.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 60, b.y + 60, { steps: 4 });
  await page.mouse.move(b.x + 260, b.y + 240, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.term.linked')).toHaveText('6');
});

test('missing view settings fall back to defaults (zoom 100%, grid off)', async ({ page }) => {
  await seed(page, OLD_STATE);
  await expect(page.locator('#zoomLevel')).toHaveText('100%');
  await expect(page.locator('#canvasWrap')).not.toHaveClass(/grid-on/);
});

test('saved zoom and grid are restored', async ({ page }) => {
  await seed(page, {
    blocks: [{ id: 'b1', x: 60, y: 60, label: '', terms: [{ type: 'number', value: '5', tid: 't1' }] }],
    nextId: 2, nextTid: 2, zoom: 1.2, showGrid: true
  });
  await expect(page.locator('#zoomLevel')).toHaveText('120%');
  await expect(page.locator('#canvasWrap')).toHaveClass(/grid-on/);
});

test('corrupt localStorage does not crash the app', async ({ page }) => {
  await seed(page, 'this is not json {{{');
  await expect(page.locator('#hint')).toBeVisible(); // empty-canvas hint, app booted fine
  await expect(page.locator('.block')).toHaveCount(0);
});

test('malformed-but-valid state is normalized (no crash on a termless block)', async ({ page }) => {
  await seed(page, { canvases: [{ id: 'c1', blocks: [{}, null, { terms: [{ type: 'number', value: '5' }] }] }], activeCanvasId: 'c1' });
  // app boots; the one well-formed block renders, junk blocks are dropped/normalized
  await expect(page.locator('#canvasName')).toHaveText('Canvas');
  await expect(page.locator('.block .result')).toHaveText('5');
});
