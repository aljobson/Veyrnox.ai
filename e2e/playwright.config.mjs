// Browser smoke tests for the three journeys: sign up, generate, buy
// (docs/product/ISSUES.md I5). Staging only — see e2e/README.md.
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './env.mjs';

export default defineConfig({
    testDir: '.',
    testMatch: '*.spec.mjs',
    testIgnore: 'authenticated-*.spec.mjs',
    timeout: 60_000,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
    use: {
        baseURL: BASE_URL,
        // generate.spec.mjs and buy.spec.mjs sign in with a real staging session
        // (__Host-veyrnox_refresh cookie + access token), so traces and screenshots
        // must never be retained — e2e.yml uploads test-results/ on a public repo.
        trace: 'off',
        screenshot: 'off',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
