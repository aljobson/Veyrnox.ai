import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FILM_STUDIO_ENABLED } from '../app/veyrnox/_lib/filmStudioSwitch.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the public templates page and cards pick Film Studio-free copy while the switch is off', () => {
  assert.equal(FILM_STUDIO_ENABLED, false);
  assert.match(read('app/veyrnox/presets/page.js'), /FILM_STUDIO_ENABLED \? 'presets\.lead' : 'presets\.leadNoFilm'/);
  assert.match(read('app/veyrnox/_components/PresetCard.js'), /FILM_STUDIO_ENABLED \? 'mobile\.templateDuration' : 'mobile\.templateDurationNoFilm'/);
});

test('the Film Studio-free strings exist in every locale and never name Film Studio', async () => {
  for (const code of ['en', 'ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh']) {
    const m = (await import(`../lib/i18n/messages/${code}.mjs`)).default;
    assert.ok(m['presets.leadNoFilm'], `${code} presets.leadNoFilm`);
    assert.ok(m['mobile.templateDurationNoFilm']?.includes('{n}'), `${code} templateDurationNoFilm`);
    assert.doesNotMatch(m['presets.leadNoFilm'], /Film Studio/i, code);
  }
  const en = (await import('../lib/i18n/messages/en.mjs')).default;
  assert.doesNotMatch(en['mobile.templateDurationNoFilm'], /long-film/);
  assert.match(en['presets.leadNoFilm'], /5s or 10s/);
  assert.match(en['presets.leadNoFilm'], /Nothing is charged until you generate/);
});

test('model links on public pages use the supplier-neutral id', () => {
  assert.match(read('app/veyrnox/_components/ModelsMenu.js'), /publicModelId\(model\.id\)/);
  assert.match(read('app/veyrnox/presets/[id]/page.js'), /publicModelId\(modelId\)/);
  assert.match(read('app/veyrnox/models/page.js'), /\/models\/\$\{encodeURIComponent\(m\.id\)\}/);
});
