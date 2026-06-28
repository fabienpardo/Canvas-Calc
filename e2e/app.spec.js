const { test, expect } = require('@playwright/test');
const { fresh, press, type, lastBlock, addBlock } = require('./helpers');

// ---- block creation + evaluation ----------------------------------------
test('+ button creates a block, types a live result, = re-anchors +', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '8 * 5');
  await expect(lastBlock(page).locator('.result')).toHaveText('40');
  // before =, the add button is hidden (editing); after =, it returns below the block
  await expect(page.locator('#addBtn')).toBeHidden();
  await press(page, '=');
  await expect(page.locator('#addBtn')).toBeVisible();
});

test('precedence and parentheses compute correctly', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '2 + 3 * 4');
  await expect(lastBlock(page).locator('.result')).toHaveText('14');
  await press(page, '=');
  await addBlock(page);
  await type(page, '( 2 + 3 ) * 4');
  await expect(lastBlock(page).locator('.result')).toHaveText('20');
});

test('thousand separators render while typing', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '1234567');
  await expect(lastBlock(page).locator('.term.number')).toHaveText('1,234,567');
});

// ---- drag + undo (regression: undo must restore the original position) ----
test('dragging a block moves it; undo restores the original position', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5');
  await press(page, '=');
  const block = lastBlock(page);
  const before = await block.evaluate((el) => el.style.left);
  const box = await block.boundingBox();
  // grab the block body (top-left corner, away from the value chips) and drag right
  await page.mouse.move(box.x + 6, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 6 + 120, box.y + 6, { steps: 8 });
  await page.mouse.up();
  const after = await lastBlock(page).evaluate((el) => el.style.left);
  expect(after).not.toBe(before);
  await page.locator('#undoBtn').click();
  const restored = await lastBlock(page).evaluate((el) => el.style.left);
  expect(restored).toBe(before);
});

// ---- drag-to-link creates a color-matched linked block -------------------
test('dragging a number to empty canvas creates a colored linked block', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '12');
  await press(page, '=');
  const numChip = lastBlock(page).locator('.term.number');
  const box = await numChip.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 40, { steps: 5 });
  await page.mouse.move(cx + 240, cy + 220, { steps: 8 }); // empty canvas
  await page.mouse.up();
  await expect(page.locator('.block')).toHaveCount(2);
  const linked = page.locator('.term.linked');
  await expect(linked).toHaveText('12');
  // linked chip and source underline share a non-empty color
  const color = await linked.evaluate((el) => el.style.color);
  expect(color).not.toBe('');
  await expect(page.locator('#linkLayer path')).toHaveCount(1);
});

test('plus-minus starts negative entry in empty and after-operator slots', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await press(page, 'neg');
  await press(page, '5');
  await expect(lastBlock(page).locator('.term.number')).toHaveText('-5');

  await press(page, '+');
  await press(page, 'neg');
  await press(page, '8');
  await expect(lastBlock(page).locator('.term.number').nth(1)).toHaveText('-8');
  await expect(lastBlock(page).locator('.result')).toHaveText('-13');
});

test('plus-minus on a linked number toggles its source, not the active block tail', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '58');
  await press(page, '=');

  const numChip = lastBlock(page).locator('.term.number');
  const box = await numChip.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 40, { steps: 5 });
  await page.mouse.move(cx + 240, cy + 220, { steps: 8 });
  await page.mouse.up();

  await press(page, '+');
  await type(page, '2554');
  const linkedBlock = page.locator('.block').nth(1);
  await linkedBlock.locator('.term.linked').click();
  await press(page, 'neg');

  await expect(page.locator('.block').first().locator('.term.number')).toHaveText('-58');
  await expect(linkedBlock.locator('.term.number')).toHaveText('2,554');
  await expect(linkedBlock.locator('.result')).toHaveText('2,496');
});

test('plus-minus on a selected result creates a locally negated linked block', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '2 + 3');
  await press(page, '=');
  await lastBlock(page).locator('.result').click();
  await press(page, 'neg');

  await expect(page.locator('.block')).toHaveCount(2);
  const negated = page.locator('.block').nth(1);
  await expect(negated.locator('.term.number')).toHaveText('-1');
  await expect(negated.locator('.term.linked')).toHaveText('5');
  await expect(negated.locator('.result')).toHaveText('-5');
});

// ---- variables sidebar ---------------------------------------------------
test('sidebar lists variables and editing an input recomputes', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '10 * 2');
  await press(page, '=');
  await page.locator('#varsBtn').click();
  const inputs = page.locator('#sidebarBody .var-val[data-kind="input"]');
  await expect(inputs).toHaveCount(2); // 10 and 2
  // edit the first input (10 -> 30) and expect the result to follow (60)
  await inputs.first().fill('30');
  await expect(page.locator('.block .result').first()).toHaveText('60');
});

test('sidebar rejects malformed numeric input', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '10 * 2');
  await press(page, '=');
  await page.locator('#varsBtn').click();
  const firstInput = page.locator('#sidebarBody .var-val[data-kind="input"]').first();

  await firstInput.fill('12abc');
  await expect(firstInput).toHaveClass(/invalid/);
  await expect(firstInput).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.block .result').first()).toHaveText('20');

  await firstInput.blur();
  await expect(firstInput).toHaveValue('10');
  await firstInput.fill('1..2');
  await expect(firstInput).toHaveClass(/invalid/);
  await expect(page.locator('.block .result').first()).toHaveText('20');

  await firstInput.fill('12.5');
  await expect(firstInput).not.toHaveClass(/invalid/);
  await expect(page.locator('.block .result').first()).toHaveText('25');
});

test('clicking the dimmed scrim closes the sidebar', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '10 * 2');
  await press(page, '=');

  const scrim = page.locator('#sidebarScrim');
  await expect(scrim).toBeHidden(); // hidden while the panel is closed

  await page.locator('#varsBtn').click();
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
  await expect(scrim).toBeVisible();

  await scrim.click({ position: { x: 20, y: 20 } }); // tap the dimmed canvas area
  await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
  await expect(page.locator('body')).not.toHaveClass(/sidebar-open/);
  await expect(scrim).toBeHidden();
});

// ---- grid toggle ---------------------------------------------------------
test('grid is off by default and toggles via the menu', async ({ page }) => {
  await fresh(page);
  const canvas = page.locator('#canvas');
  await expect(canvas).not.toHaveClass(/grid-on/);
  await page.locator('#menuBtn').click();
  await page.locator('#gridToggle').click();
  await expect(canvas).toHaveClass(/grid-on/);
  await expect(canvas).toHaveCSS('background-size', '20px 20px, 20px 20px');
});

// ---- zoom + scroll ------------------------------------------------------
test('zoom buttons scale the canvas; horizontal scroll is available', async ({ page }) => {
  await fresh(page);
  await page.locator('#zoomIn').click();
  await page.locator('#zoomIn').click();
  await expect(page.locator('#zoomLevel')).toHaveText('144%');
  const transform = await page.locator('#canvas').evaluate((el) => el.style.transform);
  expect(transform).toContain('scale(1.44)');
  await page.locator('#zoomLevel').click(); // reset
  await expect(page.locator('#zoomLevel')).toHaveText('100%');
  const canScrollX = await page.locator('#canvasWrap').evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(canScrollX).toBe(true);
});

// ---- copy / paste (mobile menu path uses the Clipboard API) --------------
test('paste from clipboard inserts parsed terms', async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => navigator.clipboard.writeText('1,234 + 5 * (2)'));
  await page.locator('#menuBtn').click();
  await page.locator('#pasteItem').click();
  await expect(lastBlock(page).locator('.result')).toHaveText('1,244');
});

test('invalid clipboard paste shows feedback and leaves the canvas unchanged', async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => navigator.clipboard.writeText('abc 5'));
  await page.locator('#menuBtn').click();
  await page.locator('#pasteItem').click();
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toastMsg')).toContainText('Paste a calculation');
  await expect(page.locator('.block')).toHaveCount(0);
});

test('keyboard users can start, navigate the menu, and select terms', async ({ page }) => {
  await fresh(page);
  const hintAdd = page.locator('.hint-mark');
  await expect(hintAdd).toHaveAttribute('aria-label', 'Start a calculation');
  await hintAdd.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.block')).toHaveCount(1);

  await page.locator('#menuBtn').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#copyItem')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#pasteItem')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#menuBtn')).toBeFocused();

  await type(page, '12 + 3');
  const firstNumber = lastBlock(page).locator('.term.number').first();
  await expect(firstNumber).toHaveAttribute('role', 'button');
  await firstNumber.focus();
  await page.keyboard.press(' ');
  await expect(firstNumber).toHaveClass(/sel/);
});

// ---- single-click label edit + backspace chain --------------------------
test('a single click on a label enters edit mode', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5');
  await press(page, '=');
  // select the block, then one click on its (empty) title caption focuses it
  await lastBlock(page).click({ position: { x: 6, y: 6 } });
  const titleCap = lastBlock(page).locator('.cap').last();
  await titleCap.click();
  const focused = await titleCap.evaluate((el) => el === document.activeElement);
  expect(focused).toBe(true);
});

test('selected terms show editing hints', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '12 + 3');

  const firstNumber = lastBlock(page).locator('.term.number').first();
  await firstNumber.click();
  await expect(firstNumber).toHaveAttribute('title', 'Selected number');
  await expect(lastBlock(page).locator('.selection-caret')).toHaveCount(1);
  await expect(lastBlock(page).locator('.cap').first()).toHaveAttribute('aria-label', 'Name number');
  await expect(lastBlock(page).locator('.cap').first()).toHaveAttribute('title', 'Name number');

  const operator = lastBlock(page).locator('.term.operator');
  await operator.click();
  await expect(operator).toHaveAttribute('title', 'Selected operator');
  await expect(lastBlock(page).locator('.selection-caret')).toHaveCount(1);
});

test('backspace chain clears to 0, deletes, then steps to the previous term', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '7 + 55');
  // select the "55" number chip
  await lastBlock(page).locator('.term.number').last().click();
  await press(page, 'back'); // 55 -> 5
  await expect(lastBlock(page).locator('.term.number').last()).toHaveText('5');
  await press(page, 'back'); // 5 -> 0 (empty slot)
  await expect(lastBlock(page).locator('.term.number').last()).toHaveText('0');
  await press(page, 'back'); // delete the number -> operator becomes selected
  await expect(lastBlock(page).locator('.term.operator.sel')).toHaveCount(1);
});
