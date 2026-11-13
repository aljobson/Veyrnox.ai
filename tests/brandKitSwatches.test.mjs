import test from 'node:test';
import assert from 'node:assert/strict';
import { BRAND_SWATCHES, brandKitProblem, emptyBrandKit } from '../lib/editorShared.js';
import { STUDIO_DESTINATIONS } from '../app/veyrnox/_lib/studioNavigation.js';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';

test('brand kit offers ten distinct valid colours, each with a name in every language', async () => {
  assert.equal(BRAND_SWATCHES.length, 10);
  assert.equal(new Set(BRAND_SWATCHES.map(s => s.hex)).size, 10);
  const kit = { ...emptyBrandKit(), palette: BRAND_SWATCHES.map(s => s.hex) };
  assert.equal(brandKitProblem(kit), null);
  for (const locale of ['en', 'de', 'ja', 'ar']) {
    const messages = await appMessagesFor(locale);
    for (const { id } of BRAND_SWATCHES) assert.ok(messages[`app.editor.brand.swatch.${id}`], `${locale} ${id}`);
  }
});

test('Brand kit has its own signed-in destination behind the projects switch', () => {
  const row = STUDIO_DESTINATIONS.find(d => d.key === 'brandKit');
  assert.equal(row.href, '/app/brand-kit');
  assert.equal(row.flag, 'projects');
});
