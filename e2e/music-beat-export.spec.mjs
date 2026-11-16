// Daily staging smoke only (e2e/playwright.config.mjs); never a PR deployment test.
import { test, expect } from '@playwright/test';
import { HAS_ACCOUNT } from './env.mjs';
import { signedIn } from './session.mjs';
test('375 px beat exports a stereo WAV download', async ({ page }) => {
  test.skip(!HAS_ACCOUNT, 'E2E_EMAIL / E2E_PASSWORD not set');
  await signedIn(page); await page.setViewportSize({ width: 375, height: 812 });
  // This smoke creates only a device-local beat, even after cloud rollout.
  await page.route('**/api/v1/music/beat-projects**', route => route.fulfill({ status: 503,
    contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }) }));
  const response = await page.goto('/app/music/beats');
  test.skip(response.status() === 404, 'beatEditor is not enabled on staging');
  await page.getByRole('button', { name: 'New beat', exact: true }).click();
  await page.getByRole('button', { name: 'Download WAV', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export beat' });
  await expect(dialog.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await pending; expect(download.suggestedFilename()).toMatch(/\.wav$/);
  const stream = await download.createReadStream(), pieces = [];
  for await (const piece of stream) pieces.push(piece);
  const bytes = Buffer.concat(pieces); expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
  expect(bytes.readUInt16LE(22)).toBe(2); expect(bytes.readUInt32LE(24)).toBe(48000);
});
