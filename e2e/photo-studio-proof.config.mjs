import { defineConfig } from '@playwright/test';
const baseURL = process.env.PHOTO_PROOF_ORIGIN || 'http://127.0.0.1:8796';
const origin = new URL(baseURL);
if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(origin.hostname) || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('Photo proof requires the local built Worker origin.');
export default defineConfig({
    testDir: '.', testMatch: 'photo-studio.proof.mjs', workers: 1,
    timeout: 180000, use: { baseURL, trace: 'off', screenshot: 'off',
        browserName: 'chromium', launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
});
