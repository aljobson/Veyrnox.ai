import { defineConfig } from '@playwright/test';
// The mobile runtime page is a local file (as in the app's WebView): no Worker, no server.
export default defineConfig({
    testDir: '.', testMatch: ['photo-studio-mobile-live.proof.mjs'], workers: 1, timeout: 300000,
    use: { trace: 'off', screenshot: 'off', browserName: 'chromium',
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } },
});
