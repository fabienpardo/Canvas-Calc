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

test('selected number + opening parenthesis inserts before the selected number', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '2 + 4');
  await press(page, '=');
  await lastBlock(page).locator('.term.number', { hasText: '2' }).click();
  await press(page, '(');
  await expect(lastBlock(page).locator('.expr .term')).toHaveText(['(', '2', '+', '4']);
  // The '(' now has no match, so the block is unresolved until it's closed.
  await expect(lastBlock(page).locator('.result')).toHaveText('?');
  await expect(lastBlock(page).locator('.result-why')).toHaveText('Close the parenthesis to calculate.');
});

test('pressing = auto-closes an open parenthesis into the expression', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '7');
  await press(page, '+');
  await type(page, '5');
  await press(page, '*');
  await press(page, '(');
  await type(page, '2 + 3');
  await press(page, '-');
  await type(page, '5');
  // Before =, the group is still open (no trailing ')').
  await expect(lastBlock(page).locator('.expr .term.paren')).toHaveText(['(']);
  await press(page, '=');
  // The matching ')' is written into the block; result stays 7 + 5*(2+3-5) = 7.
  await expect(lastBlock(page).locator('.expr .term')).toHaveText(['7', '+', '5', '×', '(', '2', '+', '3', '−', '5', ')']);
  await expect(lastBlock(page).locator('.result')).toHaveText('7');
});

test('tapping empty canvas auto-closes an open parenthesis', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '7');
  await press(page, '+');
  await press(page, '(');
  await type(page, '2 + 3');
  // Still open before leaving the block (no trailing ')').
  await expect(lastBlock(page).locator('.expr .term.paren')).toHaveText(['(']);
  await page.locator('#canvas').click({ position: { x: 600, y: 460 } });
  // Leaving via an empty-canvas tap writes the matching ')'; 7 + (2+3) = 12.
  await expect(lastBlock(page).locator('.expr .term.paren')).toHaveText(['(', ')']);
  await expect(lastBlock(page).locator('.result')).toHaveText('12');
});

test('editing a label then tapping empty canvas saves it', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5');
  await press(page, '=');
  await lastBlock(page).click({ position: { x: 6, y: 6 } }); // select -> reveals title caption
  const titleCap = lastBlock(page).locator('.cap').last();
  await titleCap.click();
  await page.keyboard.type('Total');
  // Commit by tapping empty canvas rather than pressing Enter / blurring directly.
  await page.locator('#canvas').click({ position: { x: 600, y: 460 } });
  await expect(lastBlock(page).locator('.cap').last()).toHaveText('Total');
  // And it survives a reload (was actually persisted).
  await page.reload();
  await expect(page.locator('.block .cap').last()).toHaveText('Total');
});

test('opening "(" after a number inserts an implicit multiplication', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '3');
  await press(page, '(');
  await type(page, '2 + 6');
  await press(page, ')');
  await expect(lastBlock(page).locator('.expr .term')).toHaveText(['3', '×', '(', '2', '+', '6', ')']);
  await expect(lastBlock(page).locator('.op-missing')).toHaveCount(0);
  await expect(lastBlock(page).locator('.result')).toHaveText('24');
});

test('tapping the missing-operator "?" lets you fill the operator', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  // Force a real gap: type an operand, then a second operand with no operator
  // (operator selected + digit drops a new operand right after).
  await type(page, '5 + 8');
  await lastBlock(page).locator('.term.operator').click();
  await press(page, '3'); // -> 5 + 8 3  (gap before the 3)
  await expect(lastBlock(page).locator('.op-missing')).toHaveCount(1);
  await lastBlock(page).locator('.op-missing').click();
  await expect(lastBlock(page).locator('.op-missing')).toHaveClass(/sel/);
  await press(page, '*'); // fill the gap with x
  await expect(lastBlock(page).locator('.op-missing')).toHaveCount(0);
  await expect(lastBlock(page).locator('.result')).toHaveText('29'); // 5 + 8*3
});

test('the missing-operator inline picker fills the gap', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5 + 8');
  await lastBlock(page).locator('.term.operator').click();
  await press(page, '3'); // -> 5 + 8 3 (gap before the 3)
  await lastBlock(page).locator('.op-missing').click(); // selecting reveals the picker
  await expect(lastBlock(page).locator('.op-picker')).toBeVisible();
  await lastBlock(page).locator('.op-pick[data-op="+"]').click();
  await expect(lastBlock(page).locator('.op-missing')).toHaveCount(0);
  await expect(lastBlock(page).locator('.result')).toHaveText('16'); // 5 + 8 + 3
});

test('parentheses are selectable and deletable', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await press(page, '(');
  await type(page, '2 + 4');
  await press(page, ')');

  const block = lastBlock(page);
  await block.locator('.term.paren').first().click();
  await expect(block.locator('.term.paren').first()).toHaveClass(/sel/);
  await press(page, 'back');
  await expect(block.locator('.term.paren')).toHaveCount(1);
  await expect(block.locator('.term.paren')).toHaveText(')');

  await block.locator('.term.paren').click();
  await press(page, 'back');
  await expect(block.locator('.term.paren')).toHaveCount(0);
  await expect(block.locator('.result')).toHaveText('6');
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
  await expect(page.locator('#toast')).toBeVisible(); // clearing the canvas now confirms first
  await page.locator('#toastRow button.danger').click();
  await expect(page.locator('.block')).toHaveCount(0);
  await page.locator('#undoBtn').click();
  await expect(page.locator('.block')).toHaveCount(2);
});

test('text size submenu applies the chosen size and marks the active option', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '7');
  await press(page, '=');
  const block = lastBlock(page);
  await page.locator('#menuBtn').click();
  // Default size is Medium (22px).
  await expect(page.locator('.size-item[data-size="22"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('.size-item[data-size="28"]').click(); // Large
  await expect
    .poll(() => block.evaluate((el) => getComputedStyle(el).getPropertyValue('--fs').trim()))
    .toBe('28px');
  await page.locator('#menuBtn').click();
  await expect(page.locator('.size-item[data-size="28"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.size-item[data-size="22"]')).toHaveAttribute('aria-checked', 'false');
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
