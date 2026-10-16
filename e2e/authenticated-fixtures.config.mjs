import { defineConfig, devices } from '@playwright/test';

// This suite never imports staging credentials or accepts captured user sessions.
const rawOrigin = process.env.QA_FIXTURE_BASE_URL || 'http://127.0.0.1:3100';
if (!/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/i.test(rawOrigin)) throw new Error('Synthetic fixtures require an exact HTTP loopback origin');
const baseURL = new URL(rawOrigin).origin;
if (process.env.QA_STORAGE_STATE) throw new Error('Synthetic fixtures refuse real storage state');

export default defineConfig({
  testDir: '.', testMatch: 'authenticated-*.spec.mjs', timeout: 60_000,
  forbidOnly: Boolean(process.env.CI), retries: 0, workers: 1,
  outputDir: process.env.QA_FIXTURE_OUTPUT_DIR || 'authenticated-fixture-results',
  reporter: [['list'], ['json', { outputFile: process.env.QA_FIXTURE_REPORT || 'authenticated-fixture-results/report.json' }]],
  use: { baseURL, serviceWorkers: 'block', reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure', actionTimeout: 10_000, navigationTimeout: 30_000 },
  projects: [
    { name: 'synthetic-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'synthetic-mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
