const { test, expect } = require('@playwright/test');
const { fresh, press, type, lastBlock, seed, addBlock } = require('./helpers');

const openMenu = (page) => page.locator('#canvasBtn').click();
const switchTo = (page, title) => page.locator('#canvasMenu button.cv-name', { hasText: title }).click();
const savedStateMatches = (page, predicate) => page.waitForFunction(predicate);
async function renameCurrentCanvas(page, title) {
  await page.locator('#canvasMenu .cv-row.active button.cv-name').click();
  await page.locator('#canvasMenu .cv-row.active input.cv-name').fill(title);
}

// Block and token ids are intentionally canvas-local, so both sheets use b1
// (and t1/t2). These fixtures exercise transient operations across that boundary.
function twoCanvasLinkState() {
  return {
    canvases: [
      {
        id: 'c1', title: 'Canvas 1', nextId: 3, nextTid: 3, zoom: 1,
        blocks: [
          { id: 'b1', x: 40, y: 30, label: '', terms: [
            { type: 'number', value: '2', tid: 't1' },
            { type: 'operator', value: '+' },
            { type: 'number', value: '3', tid: 't2' }
          ] },
          { id: 'b2', x: 40, y: 130, label: '', terms: [{ type: 'linked', sourceId: 'b1' }] }
        ]
      },
      {
        id: 'c2', title: 'Canvas 2', nextId: 2, nextTid: 3, zoom: 1,
        blocks: [{ id: 'b1', x: 40, y: 30, label: '', terms: [
          { type: 'number', value: '4', tid: 't1' },
          { type: 'operator', value: '+' },
          { type: 'number', value: '5', tid: 't2' }
        ] }]
      }
    ],
    activeCanvasId: 'c1', nextCanvasId: 3, fontSize: 22, showGrid: false
  };
}

test('a new canvas is isolated; switching back preserves content', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '2 * 3');
  await press(page, '=');
  await expect(lastBlock(page).locator('.result')).toHaveText('6');

  await openMenu(page);
  await page.locator('#canvasMenu .cv-new').click(); // -> new canvas, switched to it
  await expect(page.locator('#canvasName')).toHaveText('Canvas 2');
  await expect(page.locator('.block')).toHaveCount(0);

  await addBlock(page);
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

test('switching canvases cancels an in-progress keyboard link', async ({ page }) => {
  await seed(page, twoCanvasLinkState());
  const source = page.locator('.block').first();
  await source.locator('.result').focus();
  await page.keyboard.press(' ');
  await page.keyboard.press('l');
  await expect(page.locator('#linkStatus')).toContainText('Linking 5');

  await openMenu(page);
  await switchTo(page, 'Canvas 2');
  await expect(page.locator('#linkStatus')).toBeHidden();

  // L now starts a fresh flow instead of silently resolving Canvas 1's b1
  // against Canvas 2's identically named b1.
  await page.keyboard.press('l');
  await expect(page.locator('#linkStatus')).toContainText('Select a result or number');
  await expect(page.locator('.term.linked')).toHaveCount(0);
});

test('pasting a copied live link into another canvas freezes its copied value', async ({ page }) => {
  await seed(page, twoCanvasLinkState());
  const alias = page.locator('.block').nth(1);
  await alias.locator('.result').click();
  await page.locator('#menuBtn').click();
  await page.locator('#copyItem').click();

  await openMenu(page);
  await switchTo(page, 'Canvas 2');
  await page.locator('#menuBtn').click();
  await page.locator('#pasteItem').click();

  // Canvas 2 also has b1, but it is 9. The pasted alias must retain Canvas 1's
  // copied value (5) as a number rather than rebinding to this b1.
  const pasted = page.locator('.block').nth(1);
  await expect(pasted.locator('.term.linked')).toHaveCount(0);
  await expect(pasted.locator('.term.number')).toHaveText('5');
});

test('renaming the current canvas persists across reload', async ({ page }) => {
  await fresh(page);
  await openMenu(page);
  await renameCurrentCanvas(page, 'Taxes');
  await expect(page.locator('#canvasName')).toHaveText('Taxes');
  await savedStateMatches(page, () => {
    try {
      return JSON.parse(localStorage.getItem('canvascalc.v1')).canvases.some((c) => c.title === 'Taxes');
    } catch (e) {
      return false;
    }
  });
  await page.reload();
  await expect(page.locator('#canvasName')).toHaveText('Taxes');
});

test('renaming a canvas can be undone and redone in one step', async ({ page }) => {
  await fresh(page);
  await openMenu(page);
  await renameCurrentCanvas(page, 'Taxes');
  await expect(page.locator('#canvasName')).toHaveText('Taxes');
  await page.locator('#canvasBtn').click(); // close the menu
  await page.locator('#undoBtn').click();
  await expect(page.locator('#canvasName')).toHaveText('Canvas 1');
  await page.locator('#redoBtn').click();
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
  await addBlock(page); await type(page, '7'); await press(page, '=');
  await openMenu(page);
  await page.locator('#canvasMenu .cv-new').click();
  await addBlock(page); await type(page, '8'); await press(page, '=');
  await savedStateMatches(page, () => {
    try {
      const saved = JSON.parse(localStorage.getItem('canvascalc.v1'));
      return saved.canvases.length === 2 &&
        saved.canvases.some((c) => (c.blocks || []).some((b) => (b.terms || []).some((t) => t.value === '8')));
    } catch (e) {
      return false;
    }
  });
  await page.reload();
  await openMenu(page);
  await expect(page.locator('#canvasMenu .cv-row')).toHaveCount(2);
  await page.locator('#canvasBtn').click(); // close
  await expect(lastBlock(page).locator('.term.number')).toHaveText('8'); // active canvas restored
  await openMenu(page);
  await switchTo(page, 'Canvas 1');
  await expect(lastBlock(page).locator('.term.number')).toHaveText('7');
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
