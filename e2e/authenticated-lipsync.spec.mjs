import { test, expect, installProductFixtures, SYNTHETIC_USER } from './fixtures/authenticated-product.mjs';
import { lipSyncMp4 } from '../tests/fixtures/lipSyncMp4.mjs';

for (const [error, message] of [
  ['lipsync_audio_exceeds_video', 'The speech is longer than the video.'],
  ['lipsync_video_length_unknown', 'We could not verify the video\'s visual duration for lip sync.'],
]) test(`LatentSync explains ${error} without an automatic retry or balance change`, async ({ page }) => {
  const fixture = await installProductFixtures(page, { routes: ({ url, method, body, json, route }) => {
    if (url.pathname === '/api/v1/uploads' && method === 'POST') {
      const extension = body.content_type === 'video/mp4' ? 'mp4' : 'wav';
      return json({ upload_url: `${url.origin}/synthetic-lipsync-source.${extension}`, key: `uploads/${SYNTHETIC_USER.id}/00000000-0000-4000-8000-000000000022.${extension}`, content_type: body.content_type });
    }
    if (url.pathname.startsWith('/synthetic-lipsync-source.') && method === 'PUT') return route.fulfill({ status: 200, body: '' }).then(() => true);
    if (url.pathname === '/api/v1/generations' && method === 'POST') return json({ error }, 400);
    return false;
  } });
  await fixture.open('/app/create?model=latentsync');
  await expect(page.getByText(/Speech must not be longer than the video/)).toBeVisible();
  await page.getByTestId('source-upload-video').setInputFiles({ name: 'synthetic-7.2s.mp4', mimeType: 'video/mp4', buffer: lipSyncMp4() });
  await page.getByTestId('source-upload-audio').setInputFiles({ name: 'synthetic-speech.wav', mimeType: 'audio/wav', buffer: Buffer.from('Synthetic test bytes, never sent to a provider') });
  await page.getByTestId('create-source-rights').check(); // Synthetic-only declaration, no account or provider writes.
  await page.locator('[data-assistant-target="create.generate"]').click();
  await expect(page.getByRole('alert').filter({ hasText: message })).toContainText('Nothing was charged.');
  await expect(page.getByTestId('app-credit-balance')).toBeVisible();
  await expect(page.getByTestId('app-credit-balance')).toHaveAttribute('aria-label', 'Credit balance: 1,000 credits');
  expect(fixture.requests.filter(row => row.path === '/api/v1/generations')).toHaveLength(1);
  expect(fixture.state.balance).toBe(1000);
});
