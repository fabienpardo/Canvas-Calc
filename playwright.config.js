const { defineConfig, devices } = require('@playwright/test');

// E2E / integration tests for the canvas interaction layer (the part engine.js
// unit tests can't reach). Dev-only — never shipped with the app.

// Default lane is Chromium. The iOS/WebKit lane is opt-in (PW_IOS=1) because
// WebKit isn't provisioned everywhere; install it with
// `npx playwright install webkit` and run `npm run test:e2e:ios`.
const projects = [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }];
if (process.env.PW_IOS) projects.push({ name: 'ios-safari', use: { ...devices['iPhone 13'] } });

module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8765',
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'python3 -m http.server 8765',
    url: 'http://localhost:8765',
    reuseExistingServer: true,
    timeout: 30000,
  },
  projects: projects,
});
