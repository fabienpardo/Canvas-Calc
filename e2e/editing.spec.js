const { test, expect } = require('@playwright/test');
const { fresh, press, type, lastBlock, addBlock } = require('./helpers');

// ---- editing model flows -------------------------------------------------
test('insert in the middle: 5 + 7 + 2, select 7, type - 4 => 5 + 7 - 4 + 2 = 10', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5 + 7 + 2');
  await lastBlock(page).locator('.term.number', { hasText: '7' }).click();
  await press(page, '-');
  await press(page, '4');
  await expect(lastBlock(page).locator('.result')).toHaveText('10');
});

test('operator replacement: tap + then press * changes the operator', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '8 + 5');
  await lastBlock(page).locator('.term.operator').click();
  await press(page, '*');
  await expect(lastBlock(page).locator('.result')).toHaveText('40');
});

test('backspace on a selected linked term unlinks it', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '12');
  await press(page, '=');
  // drag the 12 to empty canvas to make a linked block
  const chip = lastBlock(page).locator('.term.number');
  const b = await chip.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 60, b.y + 60, { steps: 4 });
  await page.mouse.move(b.x + 240, b.y + 220, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.term.linked')).toHaveCount(1);
  await page.locator('.term.linked').click();
  await press(page, 'back');
  await expect(page.locator('.term.linked')).toHaveCount(0);
});

test('backspace on a fresh empty block deletes the block', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await expect(page.locator('.block')).toHaveCount(1);
  await expect(lastBlock(page)).toHaveClass(/empty-draft/);
  await expect(lastBlock(page).locator('.block-del')).toBeHidden();
  await press(page, 'back');
  await expect(page.locator('.block')).toHaveCount(0);
});

// ---- undo / redo ---------------------------------------------------------
test('typing then undo reverts the last digit', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '55');
  await expect(lastBlock(page).locator('.term.number')).toHaveText('55');
  await page.locator('#undoBtn').click();
  await expect(lastBlock(page).locator('.term.number')).toHaveText('5');
});

test('delete a block then undo restores it; redo removes it again', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5');
  await press(page, '=');
  await expect(page.locator('.block')).toHaveCount(1);
  await lastBlock(page).click({ position: { x: 6, y: 6 } }); // select -> reveals × button
  await lastBlock(page).locator('.block-del').click();
  await page.locator('#toastRow button.danger').click(); // confirm Delete
  await expect(page.locator('.block')).toHaveCount(0);
  await page.locator('#undoBtn').click();
  await expect(page.locator('.block')).toHaveCount(1);
  await page.locator('#redoBtn').click();
  await expect(page.locator('.block')).toHaveCount(0);
});

test('a new action clears the redo stack', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5');
  await page.locator('#undoBtn').click();   // something to redo
  await expect(page.locator('#redoBtn')).toBeEnabled();
  await addBlock(page);    // new action
  await type(page, '9');
  await expect(page.locator('#redoBtn')).toBeDisabled();
});

test('clear canvas then undo restores all blocks', async ({ page }) => {
  await fresh(page);
  await addBlock(page); await type(page, '1'); await press(page, '=');
  await addBlock(page); await type(page, '2'); await press(page, '=');
  await expect(page.locator('.block')).toHaveCount(2);
  await page.locator('#menuBtn').click();
  await page.locator('#clearBtn').click();
  await page.locator('#toastRow button.danger').click(); // confirm Clear all
  await expect(page.locator('.block')).toHaveCount(0);
  await page.locator('#undoBtn').click();
  await expect(page.locator('.block')).toHaveCount(2);
});

test('paste then undo removes the pasted block', async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => navigator.clipboard.writeText('3 + 4'));
  await page.locator('#menuBtn').click();
  await page.locator('#pasteItem').click();
  await expect(lastBlock(page).locator('.result')).toHaveText('7');
  // undo back to an empty canvas (paste creates and fills the block as one action)
  await page.locator('#undoBtn').click();
  await expect(page.locator('.block')).toHaveCount(0);
});
