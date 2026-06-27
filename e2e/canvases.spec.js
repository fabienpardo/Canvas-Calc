const { test, expect } = require('@playwright/test');
const { fresh, press, type, lastBlock, seed } = require('./helpers');

const openMenu = (page) => page.locator('#canvasBtn').click();
const switchTo = (page, title) => page.locator('#canvasMenu button.cv-name', { hasText: title }).click();

test('a new canvas is isolated; switching back preserves content', async ({ page }) => {
  await fresh(page);
  await page.locator('#addBtn').click();
  await type(page, '2 * 3');
  await press(page, '=');
  await expect(lastBlock(page).locator('.result')).toHaveText('6');

  await openMenu(page);
  await page.locator('#canvasMenu .cv-new').click(); // -> new canvas, switched to it
  await expect(page.locator('#canvasName')).toHaveText('Canvas 2');
  await expect(page.locator('.block')).toHaveCount(0);

  await page.locator('#addBtn').click();
  await type(page, '9');
  await press(page, '=');
  await expect(page.locator('.block')).toHaveCount(1);

  await openMenu(page);
  await switchTo(page, 'Canvas 1');
  await expect(page.locator('#canvasName')).toHaveText('Canvas 1');
  await expect(page.locator('.block')).toHaveCount(1);
  await expect(lastBlock(page).locator('.result')).toHaveText('6');
});

test('each canvas keeps its own zoom', async ({ page }) => {
  await fresh(page);
  await page.locator('#zoomIn').click();
  await page.locator('#zoomIn').click();
  await expect(page.locator('#zoomLevel')).toHaveText('144%');
  await openMenu(page);
  await page.locator('#canvasMenu .cv-new').click(); // new canvas
  await expect(page.locator('#zoomLevel')).toHaveText('100%');
  await openMenu(page);
  await switchTo(page, 'Canvas 1');
  await expect(page.locator('#zoomLevel')).toHaveText('144%');
});

test('renaming the current canvas persists across reload', async ({ page }) => {
  await fresh(page);
  await openMenu(page);
  await page.locator('#canvasMenu input.cv-name').fill('Taxes');
  await expect(page.locator('#canvasName')).toHaveText('Taxes');
  await page.waitForTimeout(500); // let the debounced save flush
  await page.reload();
  await expect(page.locator('#canvasName')).toHaveText('Taxes');
});

test('deleting a canvas asks for confirmation and falls back', async ({ page }) => {
  await fresh(page);
  await openMenu(page);
  await page.locator('#canvasMenu .cv-new').click(); // now 2 canvases, Canvas 2 active
  await openMenu(page);
  await page.locator('#canvasMenu .cv-row.active .cv-del').click();
  await expect(page.locator('#toastMsg')).toContainText('Delete');
  await page.locator('#toastRow button.danger').click();
  await expect(page.locator('#canvasName')).toHaveText('Canvas 1');
  await openMenu(page);
  await expect(page.locator('#canvasMenu .cv-row')).toHaveCount(1);
});

test('multiple canvases persist across reload', async ({ page }) => {
  await fresh(page);
  await page.locator('#addBtn').click(); await type(page, '7'); await press(page, '=');
  await openMenu(page);
  await page.locator('#canvasMenu .cv-new').click();
  await page.locator('#addBtn').click(); await type(page, '8'); await press(page, '=');
  await page.waitForTimeout(500);
  await page.reload();
  await openMenu(page);
  await expect(page.locator('#canvasMenu .cv-row')).toHaveCount(2);
  await page.locator('#canvasBtn').click(); // close
  await expect(lastBlock(page).locator('.result')).toHaveText('8'); // active canvas restored
  await openMenu(page);
  await switchTo(page, 'Canvas 1');
  await expect(lastBlock(page).locator('.result')).toHaveText('7');
});

test('an old single-canvas save migrates into one named canvas', async ({ page }) => {
  await seed(page, {
    blocks: [{ id: 'b1', x: 60, y: 60, label: '', terms: [
      { type: 'number', value: '6' }, { type: 'operator', value: '*' }, { type: 'number', value: '7' }
    ] }],
    nextId: 2
  });
  await expect(page.locator('#canvasName')).toHaveText('Canvas 1');
  await expect(lastBlock(page).locator('.result')).toHaveText('42');
  await openMenu(page);
  await expect(page.locator('#canvasMenu .cv-row')).toHaveCount(1);
});
