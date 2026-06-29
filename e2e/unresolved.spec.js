const { test, expect } = require('@playwright/test');
const { fresh, press, type, lastBlock, addBlock } = require('./helpers');

// Phase 1/2: a block that can't resolve shows "?" plus a soft explanation of
// why, driven entirely by the engine's diagnose(). One case per reason code
// that's reachable from the keypad (broken-link is covered in linking.spec).

const result = (page) => lastBlock(page).locator('.result');
const why = (page) => lastBlock(page).locator('.result-why');

test('unmatched opening parenthesis explains how to close it', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5');
  await press(page, '*');
  await press(page, '(');
  await type(page, '2 + 3');
  await expect(result(page)).toHaveText('?');
  await expect(why(page)).toHaveText('Close the parenthesis to calculate.');
});

test('stray closing parenthesis explains how to fix it', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5 + 2');
  await press(page, ')');
  await press(page, '=');
  await expect(result(page)).toHaveText('?');
  await expect(why(page)).toHaveText('Remove or match the closing parenthesis.');
});

test('empty parentheses are unresolved, not zero', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '2');
  await press(page, '*');
  await press(page, '(');
  await press(page, ')');
  await press(page, '=');
  await expect(result(page)).toHaveText('?');
  await expect(why(page)).toHaveText('Add a value inside the parentheses.');
});

test('division by zero is unresolved with an explanation', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '1');
  await press(page, '/');
  await type(page, '0');
  await press(page, '=');
  await expect(result(page)).toHaveText('?');
  await expect(why(page)).toHaveText('Cannot divide by zero.');
});
