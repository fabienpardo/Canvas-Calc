const { test, expect } = require('@playwright/test');
const { fresh, press, type, lastBlock, addBlock } = require('./helpers');

async function dragResultTo(page, resultLocator, toX, toY) {
  const b = await resultLocator.boundingBox();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 30, cy + 30, { steps: 4 });
  await page.mouse.move(toX, toY, { steps: 8 });
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

test('dropping a result onto a number slot replaces it with a link', async ({ page }) => {
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
  const slot = page.locator('.block').nth(1).locator('.term.number', { hasText: '2' });
  const sb = await slot.boundingBox();
  await dragResultTo(page, a.locator('.result'), sb.x + sb.width / 2, sb.y + sb.height / 2);
  // B becomes 10 + 3 = 13
  await expect(page.locator('.block').nth(1).locator('.result')).toHaveText('13');
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
  await dragResultTo(page, b.locator('.result'), ab.x + 30, ab.y + 20);
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toastMsg')).toContainText('loop');
});

test('deleting a linked-to block warns about dependents', async ({ page }) => {
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
  await expect(page.locator('#toastMsg')).toContainText('use this one');
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
  // delete A; B should keep 10 as a constant (not become malformed/empty)
  await a.click({ position: { x: 6, y: 6 } });
  await a.locator('.block-del').click();
  await page.locator('#toastRow button.danger').click();
  await expect(page.locator('.block')).toHaveCount(1);
  await expect(page.locator('.block').first().locator('.term.number')).toHaveText('10');
  await expect(page.locator('.term.linked')).toHaveCount(0); // link was frozen to a number
});
