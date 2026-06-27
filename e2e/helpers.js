// Shared helpers for the canvas-calc e2e specs.
async function fresh(page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.padgrid .key[data-k="("]'); // engine + UI ready
}
// Keys fire on pointerdown; a real click dispatches pointerdown first, so click works.
async function press(page, k) { await page.locator(`.padgrid .key[data-k="${k}"]`).click(); }
async function type(page, seq) {
  for (const tok of seq.split(' ')) for (const ch of tok.split('')) await press(page, ch);
}
const lastBlock = (page) => page.locator('.block').last();

// Add a calculation block via whichever add control is showing: on an empty
// canvas that's the hint card's "+" mark; once blocks exist it's the floating
// #addBtn below the lowest block.
async function addBlock(page) {
  const hintMark = page.locator('.hint-mark');
  if (await hintMark.isVisible().catch(() => false)) await hintMark.click();
  else await page.locator('#addBtn').click();
}

// Seed a saved state, then load the app with it in localStorage.
async function seed(page, stateOrRaw) {
  await page.goto('/');
  await page.evaluate((s) => {
    localStorage.setItem('canvascalc.v1', typeof s === 'string' ? s : JSON.stringify(s));
  }, stateOrRaw);
  await page.reload();
}

module.exports = { fresh, press, type, lastBlock, seed, addBlock };
