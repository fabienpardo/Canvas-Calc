const { test, expect } = require('@playwright/test');
const { fresh, press, type, lastBlock, seed, addBlock } = require('./helpers');

// ---- link discoverability nudge -----------------------------------------
test('link tip shows after the first result, then stays dismissed', async ({ page }) => {
  await fresh(page);
  await expect(page.locator('#linkTip')).toBeHidden(); // nothing linkable yet
  await addBlock(page);
  await type(page, '2 + 2');
  await press(page, '=');
  await expect(page.locator('#linkTip')).toBeVisible();
  await page.locator('#linkTipClose').click();
  await expect(page.locator('#linkTip')).toBeHidden();
  // Dismissal is persisted: it does not come back on reload.
  await page.reload();
  await page.waitForSelector('.padgrid .key[data-k="("]');
  await expect(page.locator('#linkTip')).toBeHidden();
});

// ---- block creation + evaluation ----------------------------------------
test('typing builds a live result; an idle canvas tap starts a block where you tap', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '8 * 5');
  await expect(lastBlock(page).locator('.result')).toHaveText('40');
  await press(page, '=');
  const resultDot = await lastBlock(page).locator('.result').evaluate((el) => getComputedStyle(el, '::after').content);
  expect(resultDot).toBe('none');

  const wrapBox = await page.locator('#canvasWrap').boundingBox();
  const tapX = wrapBox.x + 280, tapY = wrapBox.y + 260;
  await page.mouse.click(tapX, tapY);
  await expect(page.locator('.block')).toHaveCount(2);
  const draft = page.locator('.block.empty-draft');
  await expect(draft).toBeVisible();
  const draftBox = await draft.boundingBox();
  expect(Math.abs(draftBox.x - tapX)).toBeLessThanOrEqual(90);
  expect(Math.abs(draftBox.y - tapY)).toBeLessThanOrEqual(90);

  // With a draft active, another empty tap only dismisses and evaporates it.
  await page.mouse.click(wrapBox.x + 80, wrapBox.y + 300);
  await expect(page.locator('.block')).toHaveCount(1);
});

test('typing after selecting another block leaves only the draft focused', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '2 + 4');
  await press(page, '=');
  await addBlock(page);
  await type(page, '6 + 5');
  await press(page, '=');

  const selectedBlock = page.locator('.block').nth(1);
  await selectedBlock.click({ position: { x: 6, y: 6 } });
  await expect(selectedBlock).toHaveClass(/selected/);

  await press(page, '7');

  await expect(page.locator('.block')).toHaveCount(3);
  await expect(page.locator('.block.selected')).toHaveCount(0);
  await expect(page.locator('.block.active')).toHaveCount(1);
  await expect(lastBlock(page)).toHaveClass(/active/);
  await expect(lastBlock(page).locator('.term.number')).toHaveText('7');
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
  const sourceBlock = page.locator('.block').first();
  const numChip = sourceBlock.locator('.term.number');
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
  // Linked chip, source underline, and connector are intentionally visible.
  const affordance = await linked.evaluate((el) => ({
    color: getComputedStyle(el).color,
    background: getComputedStyle(el).backgroundColor,
    fontWeight: Number(getComputedStyle(el).fontWeight),
    shadow: getComputedStyle(el).boxShadow
  }));
  const sourceShadow = await numChip.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(affordance.color).not.toBe('rgba(0, 0, 0, 0)');
  expect(affordance.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(affordance.fontWeight).toBeGreaterThanOrEqual(600);
  expect(affordance.shadow).not.toBe('none');
  expect(sourceShadow).not.toBe('none');
  const linkPath = page.locator('#linkLayer path');
  await expect(linkPath).toHaveCount(1);
  await expect(linkPath).toHaveAttribute('stroke', /.+/);
  await expect(linkPath).toHaveAttribute('stroke-width', '2.5');
  await expect(linkPath).toHaveAttribute('opacity', '0.78');
  const route = await page.evaluate(() => {
    const path = document.querySelector('#linkLayer path');
    const nums = path.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
    function canvasRect(el) {
      const block = el.closest('.block');
      let x = 0, y = 0, node = el;
      while (node && node !== block) { x += node.offsetLeft; y += node.offsetTop; node = node.offsetParent; }
      return {
        left: parseFloat(block.style.left) + x,
        top: parseFloat(block.style.top) + y,
        width: el.offsetWidth,
        height: el.offsetHeight
      };
    }
    const source = canvasRect(document.querySelector('.block .term.number'));
    const target = canvasRect(document.querySelector('.term.linked'));
    return {
      startX: nums[0], startY: nums[1], endX: nums[6], endY: nums[7],
      sourceCenterX: source.left + source.width / 2,
      sourceBottom: source.top + source.height,
      targetCenterX: target.left + target.width / 2,
      targetTop: target.top
    };
  });
  expect(route.startX).toBeCloseTo(route.sourceCenterX, 0);
  expect(route.startY).toBeCloseTo(route.sourceBottom, 0);
  expect(route.endX).toBeCloseTo(route.targetCenterX, 0);
  expect(route.endY).toBeCloseTo(route.targetTop, 0);
});

test('side-by-side links still use vertical chip ports', async ({ page }) => {
  await seed(page, {
    canvases: [{
      id: 'c1',
      title: 'Canvas',
      nextId: 3,
      nextTid: 4,
      blocks: [
        { id: 'src', x: 60, y: 80, label: '', terms: [
          { type: 'number', value: '12', tid: 't1' },
          { type: 'operator', value: '+' },
          { type: 'number', value: '6', tid: 't2' }
        ] },
        { id: 'dst', x: 520, y: 84, label: '', terms: [
          { type: 'number', value: '7', tid: 't3' },
          { type: 'operator', value: '+' },
          { type: 'linked', sourceId: 'src', sourceTid: 't2' }
        ] }
      ]
    }],
    activeCanvasId: 'c1'
  });

  const linkPath = page.locator('#linkLayer path');
  await expect(linkPath).toHaveCount(1);
  const route = await page.evaluate(() => {
    const path = document.querySelector('#linkLayer path');
    const nums = path.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
    function canvasRect(el) {
      const block = el.closest('.block');
      let x = 0, y = 0, node = el;
      while (node && node !== block) { x += node.offsetLeft; y += node.offsetTop; node = node.offsetParent; }
      return {
        left: parseFloat(block.style.left) + x,
        top: parseFloat(block.style.top) + y,
        width: el.offsetWidth,
        height: el.offsetHeight
      };
    }
    const blocks = document.querySelectorAll('.block');
    const source = canvasRect(blocks[0].querySelectorAll('.term.number')[1]);
    const target = canvasRect(blocks[1].querySelector('.term.linked'));
    return {
      startX: nums[0], startY: nums[1], endX: nums[6], endY: nums[7],
      sourceCenterX: source.left + source.width / 2,
      sourceCenterY: source.top + source.height / 2,
      sourceBottom: source.top + source.height,
      targetCenterX: target.left + target.width / 2,
      targetCenterY: target.top + target.height / 2,
      targetTop: target.top
    };
  });
  expect(Math.abs(route.targetCenterY - route.sourceCenterY)).toBeLessThan(16);
  expect(route.startX).toBeCloseTo(route.sourceCenterX, 0);
  expect(route.startY).toBeCloseTo(route.sourceBottom, 0);
  expect(route.endX).toBeCloseTo(route.targetCenterX, 0);
  expect(route.endY).toBeCloseTo(route.targetTop, 0);
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

test('repeated ± on a negated result toggles in place instead of stacking blocks', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '2 + 3');
  await press(page, '=');
  await lastBlock(page).locator('.result').click();
  await press(page, 'neg'); // create "-1 × 5"
  await expect(page.locator('.block')).toHaveCount(2);
  const negated = page.locator('.block').nth(1);
  await negated.locator('.result').click();
  await press(page, 'neg'); // toggle, not a new block
  await expect(page.locator('.block')).toHaveCount(2);
  await expect(negated.locator('.term.number')).toHaveText('1');
  await expect(negated.locator('.result')).toHaveText('5');
});

test('arrow keys move a selected block by one grid step', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '2 + 3');
  await press(page, '=');
  const block = lastBlock(page);
  await block.click({ position: { x: 6, y: 6 } }); // select the whole block
  const before = await block.evaluate((el) => parseInt(el.style.left, 10));
  await page.keyboard.press('ArrowRight');
  const after = await block.evaluate((el) => parseInt(el.style.left, 10));
  expect(after - before).toBe(20);
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

test('sidebar shows selected block health', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '10 * 2');
  await press(page, '=');
  await lastBlock(page).locator('.result').click();
  await page.locator('#varsBtn').click();

  const health = page.locator('#sidebarBody .health-panel');
  await expect(health.locator('[data-health="title"]')).toHaveText(/Block b1/);
  await expect(health.locator('[data-health="status"]')).toHaveText('Resolved · 20');
  await expect(health.locator('[data-health="links"]')).toHaveText('0');
  await expect(health.locator('[data-health="uses"]')).toHaveText('None');
  await expect(health.locator('[data-health="used-by"]')).toHaveText('None');
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

test('sidebar groups operands under their block', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '10 * 2');
  await press(page, '=');
  await addBlock(page);
  await type(page, '3 + 4');
  await press(page, '=');
  await page.locator('#varsBtn').click();

  const groups = page.locator('#sidebarBody .var-group');
  await expect(groups).toHaveCount(2);
  // First block: heading result 20 over its two operands (10 and 2).
  await expect(groups.nth(0).locator('.var-head .var-val[data-kind="result"]')).toHaveText('20');
  await expect(groups.nth(0).locator('.var-val[data-kind="input"]')).toHaveCount(2);
  // Second block: result 7 over its two operands.
  await expect(groups.nth(1).locator('.var-head .var-val[data-kind="result"]')).toHaveText('7');
  await expect(groups.nth(1).locator('.var-val[data-kind="input"]')).toHaveCount(2);
});

test('an incomplete block shows as a pending group', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5');
  await press(page, '+'); // trailing operator -> not a complete result
  await page.locator('#varsBtn').click();

  const groups = page.locator('#sidebarBody .var-group');
  await expect(groups).toHaveCount(1);
  await expect(groups.locator('.var-head .var-pending')).toBeVisible();
  await expect(groups.locator('.var-head .var-val[data-kind="result"]')).toHaveCount(0);
  await expect(groups.locator('.var-val[data-kind="input"]')).toHaveCount(1); // the 5
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

test('paste inserts at the selected term instead of appending', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5 + 3');
  await press(page, '=');
  await lastBlock(page).locator('.term.number', { hasText: '5' }).click(); // select the "5"
  await page.evaluate(() => navigator.clipboard.writeText('9'));
  await page.locator('#menuBtn').click();
  await page.locator('#pasteItem').click();
  // The "9" lands right after the selected "5", glued with "+", not at the end.
  await expect(lastBlock(page).locator('.expr .term')).toHaveText(['5', '+', '9', '+', '3']);
  await expect(lastBlock(page).locator('.result')).toHaveText('17');
});

test('structured export menu copies selected block and canvas summary', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '2 + 3');
  await press(page, '=');
  await lastBlock(page).locator('.result').click();

  await page.locator('#menuBtn').click();
  await page.locator('#copyStructuredBlockItem').click();
  const blockText = await page.evaluate(() => navigator.clipboard.readText());
  expect(blockText).toContain('Canvas Calc Block v1');
  expect(blockText).toContain('block: @b1');
  expect(blockText).toContain('status: ok');
  expect(blockText).toContain('result: 5');
  expect(blockText).toContain('formula: @b1#t1 + @b1#t2');

  await page.locator('#menuBtn').click();
  await page.locator('#copyCanvasSummaryItem').click();
  const summaryText = await page.evaluate(() => navigator.clipboard.readText());
  expect(summaryText).toContain('Canvas Calc Summary v1');
  expect(summaryText).toContain('canvas: @c1 "Canvas 1"');
  expect(summaryText).toContain('- @b1 ok = 5 :: @b1#t1 + @b1#t2');
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
  await expect(page.locator('#copyStructuredBlockItem')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#copyCanvasSummaryItem')).toBeFocused();
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

test('empty result label editor has room and hides block controls', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '2 + 2');
  await press(page, '=');

  const block = lastBlock(page);
  await block.click({ position: { x: 6, y: 6 } });
  const resultCap = block.locator('.result-cell .cap');
  await resultCap.click();
  await expect(resultCap).toBeFocused();
  await expect(block.locator('.block-del')).toBeHidden();
  await expect(block.locator('.cell:not(.result-cell) .cap').first()).toBeHidden();

  const capBox = await resultCap.boundingBox();
  const resultBox = await block.locator('.result').boundingBox();
  expect(capBox.width).toBeGreaterThanOrEqual(120);
  expect(capBox.y + capBox.height).toBeLessThanOrEqual(resultBox.y - 2);
});

test('selected terms show editing hints', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '12 + 3');

  const firstNumber = lastBlock(page).locator('.term.number').first();
  await firstNumber.click();
  await expect(firstNumber).toHaveAttribute('title', 'Selected number');
  await expect(lastBlock(page).locator('.selection-caret')).toHaveCount(1);
  await expect(firstNumber.locator('.selection-caret')).toHaveCount(1);
  const selectedNumberCaret = await firstNumber.locator('.selection-caret').evaluate((el) => ({
    caret: getComputedStyle(el).backgroundColor,
    chip: getComputedStyle(el.parentElement).backgroundColor
  }));
  expect(selectedNumberCaret.caret).toBe('rgb(255, 255, 255)');
  expect(selectedNumberCaret.caret).not.toBe(selectedNumberCaret.chip);
  await expect(lastBlock(page).locator('.cap').first()).toHaveAttribute('aria-label', 'Name number');
  await expect(lastBlock(page).locator('.cap').first()).toHaveAttribute('title', 'Name number');
  await lastBlock(page).locator('.cap').first().click();
  await expect(lastBlock(page).locator('.cap').first()).toBeFocused();
  await expect(firstNumber.locator('.selection-caret')).toHaveCount(1);
  await expect(firstNumber.locator('.selection-caret')).toBeHidden();

  const operator = lastBlock(page).locator('.term.operator');
  await operator.click();
  await expect(operator).toHaveAttribute('title', 'Selected operator');
  await expect(lastBlock(page).locator('.selection-caret')).toHaveCount(1);
  await expect(operator.locator('.selection-caret')).toHaveCount(1);
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
