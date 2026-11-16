// Local real-Web-Audio qualification. No application/account writes.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
test('whole render repeat tolerance and chunk boundary release condition', async ({ page }, testInfo) => {
  await page.route('https://beat-proof.test/**', async route => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (!path) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Beat export qualification</title>' });
    if (!/^(app\/veyrnox\/_lib\/music\/|lib\/musicInstruments\.js$|tests\/fixtures\/music-beat-export-browser\.mjs$)/.test(path) || path.includes('..')) return route.abort();
    return route.fulfill({ contentType: 'text/javascript', body: await readFile(resolve(path), 'utf8') });
  });
  await page.goto('https://beat-proof.test/');
  const measured = await page.evaluate(async () => (await import('/tests/fixtures/music-beat-export-browser.mjs')).measureExportBoundary());
  await testInfo.attach('boundary-measurement.json', { body: JSON.stringify(measured), contentType: 'application/json' });
  expect(measured.maxRepeatDifference).toBeLessThanOrEqual(measured.limit);
  expect(measured.maxSampleDifference).toBeLessThanOrEqual(measured.limit);
});
