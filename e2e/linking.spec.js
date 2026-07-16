const { test, expect } = require('@playwright/test');
const { fresh, press, type, lastBlock, seed, addBlock } = require('./helpers');

function contrastRatio(a, b) {
  function rgb(s) {
    const values = (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    return /^color\(srgb\b/.test(s) ? values.map((v) => v * 255) : values;
  }
  function luminance(s) {
    const c = rgb(s).map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

async function dragResultTo(page, resultLocator, toX, toY) {
  const b = await resultLocator.boundingBox();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 30, cy + 30, { steps: 4 });
  await page.mouse.move(toX, toY, { steps: 8 });
  await page.mouse.up();
}

async function savedBlockWithFreshHistory(page) {
  await fresh(page);
  await addBlock(page);
  await type(page, '8 + 2');
  await press(page, '=');
  // History is session-only. Reload the persisted block so the assertions
  // below start from a genuinely empty undo stack.
  await page.reload();
  await expect(page.locator('.block')).toHaveCount(1);
  await expect(page.locator('#undoBtn')).toBeDisabled();
  return page.locator('.block').first();
}

async function beginBlockDrag(page, block, dx = 80, dy = 40) {
  const box = await block.boundingBox();
  await page.mouse.move(box.x + 6, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 6 + dx, box.y + 6 + dy, { steps: 4 });
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
  const source = page.locator('.block').first().locator('.result');
  const colors = await source.evaluate((el) => {
    const path = document.querySelector('#linkLayer path');
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, foreground: style.color, link: getComputedStyle(path).stroke };
  });
  expect(colors.background).toBe(colors.link);
  expect(contrastRatio(colors.background, colors.foreground)).toBeGreaterThanOrEqual(4.5);

  // Link provenance survives active editing, selection, and caption editing.
  await page.locator('.block').first().locator('.term.number').first().click();
  await expect(source).toHaveCSS('background-color', colors.link);
  await source.click();
  await expect(source).toHaveCSS('background-color', colors.link);
  await expect(source).not.toHaveCSS('box-shadow', 'none');
  await page.locator('.block').first().locator('.result-cell .cap').click();
  await expect(source).toHaveCSS('background-color', colors.link);
  await expect(source).toHaveCSS('box-shadow', 'none');
});

test('link palette keeps text and connector contrast in light and dark themes', async ({ page }) => {
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await fresh(page);
    const samples = await page.evaluate(() => {
      const host = document.createElement('div');
      host.className = 'block';
      host.style.cssText = 'position:fixed;left:-10000px;top:0;';
      document.body.appendChild(host);
      const canvas = getComputedStyle(document.querySelector('#canvasWrap')).backgroundColor;
      const out = [];
      for (let i = 0; i < 8; i++) {
        const result = document.createElement('span');
        result.className = `result linksrc link-color-${i}`;
        result.textContent = '123';
        const linked = document.createElement('span');
        linked.className = `term linked link-color-${i}`;
        linked.textContent = '123';
        host.append(result, linked);
        const rs = getComputedStyle(result), ls = getComputedStyle(linked);
        out.push({
          resultBackground: rs.backgroundColor,
          resultText: rs.color,
          linkedBackground: ls.backgroundColor,
          linkedText: ls.color,
          canvas
        });
        result.remove(); linked.remove();
      }
      host.remove();
      return out;
    });
    for (const sample of samples) {
      expect(contrastRatio(sample.resultBackground, sample.resultText)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(sample.linkedBackground, sample.linkedText)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(sample.resultBackground, sample.canvas)).toBeGreaterThanOrEqual(3);
    }
  }
});

test('unrelated link deletion does not recolor surviving sources', async ({ page }) => {
  await seed(page, {
    canvases: [{
      id: 'c1', title: 'Canvas 1', nextId: 5, nextTid: 5, zoom: 1,
      blocks: [
        { id: 'b1', x: 40, y: 40, label: '', terms: [
          { type: 'number', value: '2', tid: 't1' }, { type: 'operator', value: '+' }, { type: 'number', value: '3', tid: 't2' }
        ] },
        { id: 'b2', x: 40, y: 160, label: '', terms: [{ type: 'linked', sourceId: 'b1', sourceTid: null }] },
        { id: 'b3', x: 380, y: 40, label: '', terms: [
          { type: 'number', value: '7', tid: 't3' }, { type: 'operator', value: '+' }, { type: 'number', value: '1', tid: 't4' }
        ] },
        { id: 'b4', x: 380, y: 160, label: '', terms: [{ type: 'linked', sourceId: 'b3', sourceTid: null }] }
      ]
    }],
    activeCanvasId: 'c1', nextCanvasId: 2, fontSize: 22, showGrid: false
  });

  const survivingSource = page.locator('.block[data-id="b3"] .result');
  const survivingTarget = page.locator('.block[data-id="b4"] .term.linked');
  const colorClass = (await survivingSource.getAttribute('class')).match(/link-color-\d+/)[0];
  await expect(survivingTarget).toHaveClass(new RegExp(colorClass));

  await page.locator('.block[data-id="b2"] .result').click();
  await page.locator('.block[data-id="b2"] .block-del').click();
  await expect(page.locator('.block')).toHaveCount(3);
  await expect(survivingSource).toHaveClass(new RegExp(colorClass));
  await expect(survivingTarget).toHaveClass(new RegExp(colorClass));

  await page.reload();
  await expect(page.locator('.block[data-id="b3"] .result')).toHaveClass(new RegExp(colorClass));
  await expect(page.locator('.block[data-id="b4"] .term.linked')).toHaveClass(new RegExp(colorClass));
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

test('dragging a result back onto its own block cancels without warning styling', async ({ page }) => {
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
  await expect(a).not.toHaveClass(/drop-invalid/);
  await expect(a).not.toHaveClass(/drop-ok/);
  await expect(a.locator('.drop-caret')).toHaveCount(0);
  await page.mouse.up();
  // No-op: the block is unchanged and no link was created.
  await expect(a.locator('.expr .term')).toHaveText(['8', '+', '2']);
  await expect(page.locator('.term.linked')).toHaveCount(0);
});

test('Escape cancels an in-progress pointer link drag', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '8 + 2');
  await press(page, '=');
  const a = page.locator('.block').first();
  const rb = await a.locator('.result').boundingBox();

  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + 40, rb.y + 40, { steps: 4 });
  const ghost = page.locator('#ghost');
  const sourceColor = (await a.locator('.result').getAttribute('class')).match(/link-color-\d+/)[0];
  await expect(ghost).toBeVisible();
  await expect(ghost).toHaveClass(new RegExp(sourceColor));
  const ghostContrast = await ghost.evaluate((el) => {
    const s = getComputedStyle(el);
    return { background: s.backgroundColor, text: s.color };
  });
  expect(contrastRatio(ghostContrast.background, ghostContrast.text)).toBeGreaterThanOrEqual(4.5);
  await page.keyboard.press('Escape');
  await expect(ghost).toBeHidden();
  await page.mouse.move(rb.x + 260, rb.y + 220, { steps: 6 });
  await page.mouse.up();

  await expect(page.locator('.block')).toHaveCount(1);
  await expect(page.locator('.term.linked')).toHaveCount(0);
});

test('pointercancel clears an interrupted link drag without creating a link', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '8 + 2');
  await press(page, '=');
  const a = page.locator('.block').first();
  const rb = await a.locator('.result').boundingBox();

  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + 40, rb.y + 40, { steps: 4 });
  await expect(page.locator('#ghost')).toBeVisible();
  await page.locator('#canvasWrap').dispatchEvent('pointercancel');
  await expect(page.locator('#ghost')).toBeHidden();
  await expect(a).not.toHaveClass(/drop-ok|drop-invalid/);

  await page.mouse.up();
  await expect(page.locator('.block')).toHaveCount(1);
  await expect(page.locator('.term.linked')).toHaveCount(0);
});

test('Escape and pointercancel restore block drags without adding undo history', async ({ page }) => {
  const block = await savedBlockWithFreshHistory(page);
  const before = await block.evaluate((el) => ({ left: el.style.left, top: el.style.top }));

  await beginBlockDrag(page, block);
  await expect(block).not.toHaveCSS('left', before.left);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(block).toHaveCSS('left', before.left);
  await expect(block).toHaveCSS('top', before.top);
  await expect(page.locator('#undoBtn')).toBeDisabled();

  await beginBlockDrag(page, block, 100, 60);
  await expect(block).not.toHaveCSS('left', before.left);
  await page.locator('#canvasWrap').dispatchEvent('pointercancel');
  await page.mouse.up();
  await expect(block).toHaveCSS('left', before.left);
  await expect(block).toHaveCSS('top', before.top);
  await expect(page.locator('#undoBtn')).toBeDisabled();
});

test('a completed block drag adds one undo step that restores its original position', async ({ page }) => {
  const block = await savedBlockWithFreshHistory(page);
  const before = await block.evaluate((el) => ({ left: el.style.left, top: el.style.top }));

  await beginBlockDrag(page, block, 120, 60);
  await page.mouse.up();
  await expect(block).not.toHaveCSS('left', before.left);
  await expect(page.locator('#undoBtn')).toBeEnabled();

  await page.locator('#undoBtn').click();
  await expect(block).toHaveCSS('left', before.left);
  await expect(block).toHaveCSS('top', before.top);
  await expect(page.locator('#undoBtn')).toBeDisabled();
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
