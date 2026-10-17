import { test, expect, installProductFixtures } from './fixtures/authenticated-product.mjs';
import { flacHeader } from '../tests/fixtures/providerAudio.mjs';

const id = '00000000-0000-4000-8000-000000000085';
const job = { job_id: id, model_id: 'ace-step', state: 'succeeded', credits: 1, label: 'Synthetic legacy audio', has_asset: true, created_at: '2026-10-16T00:00:00Z' };

async function libraryAudio(page, { unavailable = false } = {}) {
  return installProductFixtures(page, { routes: async ({ url, method, route, json }) => {
    if (method !== 'GET') return false;
    if (url.hostname === 'synthetic-audio.example.invalid') {
      await route.fulfill({ status: 200, contentType: 'audio/flac', headers: url.pathname === '/download' ? { 'content-disposition': 'attachment; filename="veyrnox-00000000.flac"' } : {}, body: Buffer.from(flacHeader()) });
      return true;
    }
    if (url.pathname === '/api/v1/jobs') return json({ jobs: [job], next: null });
    if (url.pathname === `/api/v1/jobs/${id}`) return json(job);
    if (url.pathname === `/api/v1/jobs/${id}/asset`) {
      if (url.searchParams.has('download') && unavailable) return json({ error: 'internal' }, 502);
      return json({ url: `https://synthetic-audio.example.invalid/${url.searchParams.has('download') ? 'download' : 'preview'}`, mime_type: url.searchParams.has('download') ? 'audio/flac' : 'audio/mpeg', size_bytes: 46, expires_in: 900 });
    }
    return false;
  } });
}

test('Library saves a corrected legacy audio response as FLAC without generating or publishing', async ({ page }) => {
  const fixture = await libraryAudio(page);
  await fixture.open('/app/library');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('veyrnox-00000000.flac');
  await download.cancel();
  await expect(page).toHaveURL(/\/app\/library$/);
  expect(fixture.requests.filter(row => row.path.endsWith('/asset') && row.query === '?download=1')).toHaveLength(1);
  expect(fixture.requests.filter(row => !['GET', 'HEAD', 'OPTIONS'].includes(row.method) && row.path !== '/api/auth/session')).toEqual([]);
});

test('Library failed audio verification shows a retryable error without following a download URL', async ({ page }) => {
  const fixture = await libraryAudio(page, { unavailable: true });
  await fixture.open('/app/library');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not load this file. Try again.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
  expect(fixture.requests.filter(row => row.path === '/download')).toEqual([]);
  expect(fixture.requests.filter(row => !['GET', 'HEAD', 'OPTIONS'].includes(row.method) && row.path !== '/api/auth/session')).toEqual([]);
});
