const { defineConfig, devices } = require('@playwright/test');

// E2E / integration tests for the canvas interaction layer (the part engine.js
// unit tests can't reach). Dev-only — never shipped with the app.

// Default lane is Chromium. The iOS/WebKit lane is opt-in (PW_IOS=1) because
// WebKit isn't provisioned everywhere; install it with
// `npx playwright install webkit` and run `npm run test:e2e:ios`.
// Clipboard permissions are Chromium-only — WebKit rejects them at context
// creation — so they live on the Chromium project, not the shared `use`.
const projects = [{
  name: 'chromium',
  use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] }
}];
if (process.env.PW_IOS) projects.push({ name: 'ios-safari', use: { ...devices['iPhone 13'] } });

const port = process.env.PW_PORT || '8765';
const host = process.env.PW_HOST || '127.0.0.1';
const baseURL = `http://${host}:${port}`;

module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  // One CI retry absorbs rare pointer-event timing flakes on loaded runners
  // and arms the on-first-retry trace below so a recurrence is diagnosable.
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `python3 -m http.server ${port} --bind ${host}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 30000,
  },
  projects: projects,
});
