import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'music-beat-export.proof.mjs', workers: 1, timeout: 180000,
  use: { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, trace: 'off' } });
