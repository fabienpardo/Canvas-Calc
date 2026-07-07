const { test, expect } = require('@playwright/test');
const { fresh, press, type, lastBlock, addBlock, settlePointer } = require('./helpers');

async function dragResultTo(page, resultLocator, toX, toY) {
  const b = await resultLocator.boundingBox();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 30, cy + 30, { steps: 4 });
  await page.mouse.move(toX, toY, { steps: 8 });
  await settlePointer(page);
  await page.mouse.up();
}

test('selecting a result + an operator creates a linked block', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '2 + 3');
  await press(page, '=');
  await lastBlock(page).locator('.result').click(); // select result
  await press(page, '+');
  await expect(page.locator('.block')).toHaveCount(2);
  await expect(page.locator('.term.linked')).toHaveCount(1);
});

test('dropping a result onto a number chip inserts after its right half', async ({ page }) => {
  await fresh(page);
  // block A = 10
  await addBlock(page);
  await type(page, '8 + 2');
  await press(page, '=');
  // block B = 2 + 3
  await addBlock(page);
  await type(page, '2 + 3');
  await press(page, '=');
  const a = page.locator('.block').first();
  const b = page.locator('.block').nth(1);
  const slot = b.locator('.term.number', { hasText: '2' });
  const sb = await slot.boundingBox();
  await dragResultTo(page, a.locator('.result'), sb.x + sb.width * 0.8, sb.y + sb.height / 2);
  // B becomes 2 + 10 + 3 = 15; the original "2" stays put.
  const target = page.locator('.block').nth(1);
  await expect(target.locator('.expr .term')).toHaveText(['2', '+', '10', '+', '3']);
  await expect(target.locator('.result')).toHaveText('15');
});

test('dropping a result onto a number chip inserts before its left half', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '8 + 2');
  await press(page, '=');
  await addBlock(page);
  await type(page, '2 + 3');
  await press(page, '=');
  const a = page.locator('.block').first();
  const slot = page.locator('.block').nth(1).locator('.term.number', { hasText: '2' });
  const sb = await slot.boundingBox();
  await dragResultTo(page, a.locator('.result'), sb.x + sb.width * 0.2, sb.y + sb.height / 2);
  const target = page.locator('.block').nth(1);
  await expect(target.locator('.expr .term')).toHaveText(['10', '+', '2', '+', '3']);
  await expect(target.locator('.result')).toHaveText('15');
});

test('dropping a result onto a leading operator inserts before it', async ({ page }) => {
  await fresh(page);
  // block A = 15
  await addBlock(page);
  await type(page, '7 + 8');
  await press(page, '=');
  // block B = "× 2.6" (leading operator, no left operand yet)
  await addBlock(page);
  await press(page, '*');
  await type(page, '2.6');
  const a = page.locator('.block').first();
  const op = page.locator('.block').nth(1).locator('.term.operator');
  const ob = await op.boundingBox();
  await dragResultTo(page, a.locator('.result'), ob.x + ob.width / 2, ob.y + ob.height / 2);
  // B becomes 15 × 2.6 = 39
  await expect(page.locator('.block').nth(1).locator('.term.linked')).toHaveText('15');
  await expect(page.locator('.block').nth(1).locator('.result')).toHaveText('39');
});

test('an insertion caret previews the drop position while dragging', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '8 + 2');
  await press(page, '=');
  await addBlock(page);
  await type(page, '2 + 3');
  await press(page, '=');
  const a = page.locator('.block').first();
  const b = page.locator('.block').nth(1);
  const rb = await a.locator('.result').boundingBox();
  const sb = await b.locator('.term.number', { hasText: '3' }).boundingBox();
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + 30, rb.y + 30, { steps: 3 });
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2, { steps: 6 });
  await expect(b).toHaveClass(/drop-ok/);
  await expect(b.locator('.drop-caret')).toHaveCount(1);
  const preview = await b.locator('.expr').evaluate((expr) => {
    const caret = expr.querySelector('.drop-caret');
    const nextTerm = caret && caret.nextElementSibling && caret.nextElementSibling.querySelector('.term');
    return {
      previous: caret && caret.previousElementSibling ? caret.previousElementSibling.textContent.trim() : '',
      next: nextTerm ? nextTerm.textContent.trim() : ''
    };
  });
  expect(preview).toEqual({ previous: '+', next: '3' });
  await page.mouse.up();
});

test('dragging a result onto its own block is refused as an invalid zone', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '8 + 2');
  await press(page, '=');
  const a = page.locator('.block').first();
  const rb = await a.locator('.result').boundingBox();
  const nb = await a.locator('.term.number', { hasText: '8' }).boundingBox();
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + 20, rb.y + 20, { steps: 3 });
  await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2, { steps: 5 });
  await expect(a).toHaveClass(/drop-invalid/);
  await expect(a.locator('.drop-caret')).toHaveCount(0);
  await page.mouse.up();
  // No-op: the block is unchanged and no link was created.
  await expect(a.locator('.expr .term')).toHaveText(['8', '+', '2']);
  await expect(page.locator('.term.linked')).toHaveCount(0);
});

test('copy/paste keeps a linked value live within the session', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '2 + 3');
  await press(page, '=');
  const a = page.locator('.block').first();
  const ab = await a.boundingBox();
  // B = a live alias of A (drag A's result to empty canvas).
  await dragResultTo(page, a.locator('.result'), ab.x + 280, ab.y + 240);
  await expect(page.locator('.block')).toHaveCount(2);
  const b = page.locator('.block').nth(1);
  await expect(b.locator('.term.linked')).toHaveText('5');

  // Copy B, deselect, paste -> a third block that is still a live link.
  await b.locator('.result').click();
  await page.locator('#menuBtn').click();
  await page.locator('#copyItem').click();
  await page.locator('#canvas').click({ position: { x: 520, y: 430 } }); // deselect
  await page.locator('#menuBtn').click();
  await page.locator('#pasteItem').click();
  await expect(page.locator('.block')).toHaveCount(3);
  const c = page.locator('.block').nth(2);
  await expect(c.locator('.term.linked')).toHaveText('5'); // a link, not a frozen "5"

  // Editing the source cascades to the pasted copy too.
  await a.locator('.term.number', { hasText: '3' }).click();
  await press(page, 'back');
  await press(page, '8'); // A = 2 + 8 = 10
  await expect(c.locator('.term.linked')).toHaveText('10');
});

test('keyboard users can link a result into another block with the L key', async ({ page }) => {
  await fresh(page);
  // block A = 2 + 3
  await addBlock(page);
  await type(page, '2 + 3');
  await press(page, '=');
  // block B = 10
  await addBlock(page);
  await type(page, '1 0');
  await press(page, '=');
  const a = page.locator('.block').first();
  const b = page.locator('.block').nth(1);

  // Select A's result, pick it up with L.
  await a.locator('.result').focus();
  await page.keyboard.press(' ');
  await page.keyboard.press('l');
  await expect(page.locator('#linkStatus')).toContainText('Linking 5');

  // Select B's "10", place the link after it with L.
  await b.locator('.term.number', { hasText: '10' }).focus();
  await page.keyboard.press(' ');
  await page.keyboard.press('l');

  await expect(b.locator('.expr .term')).toHaveText(['10', '+', '5']);
  await expect(b.locator('.term.linked')).toHaveText('5');
  await expect(b.locator('.result')).toHaveText('15');
  await expect(page.locator('#linkStatus')).toBeHidden();
});

test('Escape cancels a pending keyboard link', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '2 + 3');
  await press(page, '=');
  const a = page.locator('.block').first();
  await a.locator('.result').focus();
  await page.keyboard.press(' ');
  await page.keyboard.press('l');
  await expect(page.locator('#linkStatus')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#linkStatus')).toBeHidden();
});

test('pending missing-operator results cannot start links', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5 + 3');
  await page.locator('.block').first().locator('.term.operator').click();
  await press(page, '8');

  const block = page.locator('.block').first();
  const box = await block.boundingBox();
  await expect(block.locator('.result.unresolved')).toHaveText('Add an operator between these values.');
  await dragResultTo(page, block.locator('.result.unresolved'), box.x + 260, box.y + 180);

  await expect(page.locator('.block')).toHaveCount(1);
  await expect(page.locator('.term.linked')).toHaveCount(0);
});

test('malformed linked sources explain dependent unknown results', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5 + 3');
  await press(page, '=');

  const source = page.locator('.block').first();
  const sourceBox = await source.boundingBox();
  await dragResultTo(page, source.locator('.result'), sourceBox.x + 260, sourceBox.y + 180);
  await expect(page.locator('.block').nth(1).locator('.result')).toHaveText('8');

  await source.locator('.term.operator').click();
  await press(page, '8');

  await expect(source.locator('.result.unresolved')).toHaveText('Add an operator between these values.');
  await expect(page.locator('.block').nth(1).locator('.term.linked')).toHaveText('?');
  await expect(page.locator('.block').nth(1).locator('.result.unresolved')).toHaveText('Fix the linked source first.');
  await expect(page.locator('.block').nth(1).locator('.result-why')).toHaveCount(0);
});

test('a link that would create a cycle is refused with a dialog', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '8 + 2');
  await press(page, '=');
  const a = page.locator('.block').first();
  // drag A's result to empty canvas -> creates B linked to A
  const ab = await a.boundingBox();
  await dragResultTo(page, a.locator('.result'), ab.x + 260, ab.y + 240);
  await expect(page.locator('.block')).toHaveCount(2);
  // now drag B's result back onto A -> A would depend on B which depends on A -> cycle
  const b = page.locator('.block').nth(1);
  const target = await a.locator('.term.number', { hasText: '8' }).boundingBox();
  await dragResultTo(page, b.locator('.result'), target.x + target.width / 2, target.y + target.height / 2);
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toastMsg')).toContainText('loop');
});

test('deleting a linked-to block confirms before freezing dependents', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '8 + 2');
  await press(page, '=');
  const a = page.locator('.block').first();
  const ab = await a.boundingBox();
  await dragResultTo(page, a.locator('.result'), ab.x + 260, ab.y + 240); // B links A
  await expect(page.locator('.block')).toHaveCount(2);
  await a.click({ position: { x: 6, y: 6 } }); // select A -> reveals × button
  await a.locator('.block-del').click();
  // A has a dependent, so deletion is gated behind a confirm dialog.
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toastMsg')).toContainText('freeze');
  await expect(page.locator('.block')).toHaveCount(2); // nothing removed yet
  await page.locator('#toastRow button.danger').click();
  await expect(page.locator('.block')).toHaveCount(1);
  await expect(page.locator('.block').first().locator('.term.number')).toHaveText('10');
  await expect(page.locator('.term.linked')).toHaveCount(0);
});

test('cancelling the freeze confirm keeps the source and its links', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '8 + 2');
  await press(page, '=');
  const a = page.locator('.block').first();
  const ab = await a.boundingBox();
  await dragResultTo(page, a.locator('.result'), ab.x + 260, ab.y + 240); // B links A
  await a.click({ position: { x: 6, y: 6 } });
  await a.locator('.block-del').click();
  await page.locator('#toastRow button', { hasText: 'Cancel' }).click();
  await expect(page.locator('.block')).toHaveCount(2);
  await expect(page.locator('.term.linked')).toHaveCount(1); // link intact
});

test('deleting a source freezes dependents to their last value', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '8 + 2');
  await press(page, '=');
  const a = page.locator('.block').first();
  const ab = await a.boundingBox();
  await dragResultTo(page, a.locator('.result'), ab.x + 260, ab.y + 240); // B = linked(A) -> 10
  await expect(page.locator('.block').nth(1).locator('.result')).toHaveText('10');
  // delete A (confirm the freeze); B should keep 10 as a constant (not malformed/empty)
  await a.click({ position: { x: 6, y: 6 } });
  await a.locator('.block-del').click();
  await page.locator('#toastRow button.danger').click();
  await expect(page.locator('.block')).toHaveCount(1);
  await expect(page.locator('.block').first().locator('.term.number')).toHaveText('10');
  await expect(page.locator('.term.linked')).toHaveCount(0); // link was frozen to a number
});
