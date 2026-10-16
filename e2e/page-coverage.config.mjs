import { defineConfig, devices } from '@playwright/test';

const baseURL = (process.env.QA_BASE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const hostname = new URL(baseURL).hostname.toLowerCase().replace(/\.+$/, '');
const production = hostname === 'veyrnox.ai' || hostname.endsWith('.veyrnox.ai');
if (production && process.env.QA_STORAGE_STATE) throw new Error('Refusing authenticated storage against production');
if (production && process.env.QA_ALLOW_PRODUCTION !== '1') {
  throw new Error('Set QA_ALLOW_PRODUCTION=1 explicitly for the read-only production page sweep');
}
export default defineConfig({
  testDir: '.', testMatch: 'page-coverage.spec.mjs', timeout: 15 * 60_000,
  forbidOnly: Boolean(process.env.CI), retries: 0, workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: process.env.QA_REPORT_DIR || 'page-coverage-report' }]],
  use: { baseURL, trace: 'off', screenshot: 'off', navigationTimeout: 30_000, actionTimeout: 10_000, reducedMotion: 'reduce' },
  projects: [
    { name: 'desktop-anonymous', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-anonymous', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    ...(process.env.QA_STORAGE_STATE ? [
      { name: 'desktop-authenticated', use: { ...devices['Desktop Chrome'], storageState: process.env.QA_STORAGE_STATE, trace: 'off', screenshot: 'off' } },
      { name: 'mobile-authenticated', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', storageState: process.env.QA_STORAGE_STATE, trace: 'off', screenshot: 'off' } },
    ] : []),
  ],
});
