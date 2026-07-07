const { test, expect } = require('@playwright/test');
const { fresh, press, type, lastBlock, addBlock } = require('./helpers');

// A block that can't resolve replaces the result chip with the engine's reason
// in the normal result slot. One case per reason code reachable from the keypad
// (broken-link is covered in linking.spec).

const unresolved = (page) => lastBlock(page).locator('.result.unresolved');

async function expectUnresolved(page, message) {
  await expect(unresolved(page)).toHaveText(message);
  await expect(lastBlock(page).locator('.result-why')).toHaveCount(0);
}

test('unmatched opening parenthesis explains how to close it', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5');
  await press(page, '*');
  await press(page, '(');
  await type(page, '2 + 3');
  await expectUnresolved(page, 'Close the parenthesis to calculate.');
});

test('stray closing parenthesis explains how to fix it', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '5 + 2');
  await press(page, ')');
  await press(page, '=');
  await expectUnresolved(page, 'Remove or match the closing parenthesis.');
});

test('empty parentheses are unresolved, not zero', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '2');
  await press(page, '*');
  await press(page, '(');
  await press(page, ')');
  await press(page, '=');
  await expectUnresolved(page, 'Add a value inside the parentheses.');
});

test('division by zero is unresolved with an explanation', async ({ page }) => {
  await fresh(page);
  await addBlock(page);
  await type(page, '1');
  await press(page, '/');
  await type(page, '0');
  await press(page, '=');
  await expectUnresolved(page, 'Cannot divide by zero.');
});
