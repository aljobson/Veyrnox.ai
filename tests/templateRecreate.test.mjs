import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PRESETS } from '../app/veyrnox/_lib/templates.js';
import {
  TEMPLATE_RECREATE_MODEL_ID,
  recreatePromptForTemplate,
  templateRecreateAvailable,
  templateRecreateEnabled,
  templateRecreateHref,
} from '../app/veyrnox/_lib/templateRecreate.js';

test('every preview template gets a bounded two-picture recreation prompt', () => {
  assert.ok(PRESETS.length > 100);
  for (const preset of PRESETS) {
    const prompt = recreatePromptForTemplate(preset);
    assert.ok(prompt.length > 200 && prompt.length <= 2000, preset.id);
    assert.match(prompt, /source video/i, preset.id);
    assert.equal((prompt.match(/@Image1/g) || []).length, 1, preset.id);
    assert.equal((prompt.match(/@Image2/g) || []).length, 1, preset.id);
    assert.doesNotMatch(prompt, /@\s*(?:image|video|element)\s*_?\s*[3-9]/i, preset.id);
    assert.doesNotMatch(prompt, /https?:\/\//i, preset.id);
  }
});

test('foreign media names are neutralised before recreation roles are assigned', () => {
  const prompt = recreatePromptForTemplate({ prompt: 'Use @image1, @Video2 and image_3.png from https://example.test/a, then orbit.' });
  assert.match(prompt, /Template direction: Use the template reference, the template reference and the template reference from then orbit\./);
  assert.equal((prompt.match(/@Image/g) || []).length, 2);
});

test('recreate handoff targets only the multi-reference model', () => {
  assert.equal(TEMPLATE_RECREATE_MODEL_ID, 'kling-o1-reference');
  assert.equal(templateRecreateHref('paper city'), '/app/create?model=kling-o1-reference&recreate=paper%20city&duration=5s');
  assert.equal(templateRecreateAvailable({ id: 'kling-o1-reference', kind: 'video', media: { video: { required: true }, image: { required: true, maxFiles: 2 } } }), true);
  assert.equal(templateRecreateAvailable({ id: 'kling-o1-reference', kind: 'video', gated: true, media: { video: { required: true }, image: { required: true, maxFiles: 2 } } }), false);
  assert.equal(templateRecreateAvailable({ id: 'kling-o1-reference', kind: 'video', premium: true, media: { video: { required: true }, image: { required: true, maxFiles: 2 } } }), false);
  assert.equal(templateRecreateAvailable({ id: 'kling-o1-reference', kind: 'video', media: { video: { required: true }, image: { required: true, maxFiles: 1 } } }), false);
  assert.equal(templateRecreateAvailable({ id: 'kling-3.0-i2v', kind: 'video', media: { image: { required: true, maxFiles: 2 } } }), false);
});

test('template pages expose Recreate only on staging and when a preview video exists', async () => {
  const page = await readFile(new URL('../app/veyrnox/presets/[id]/page.js', import.meta.url), 'utf8');
  const component = await readFile(new URL('../app/veyrnox/_components/TemplateRecreate.js', import.meta.url), 'utf8');
  assert.equal(templateRecreateEnabled('staging'), true);
  assert.equal(templateRecreateEnabled('production'), false);
  assert.equal(templateRecreateEnabled('development'), false);
  assert.match(page, /templateRecreateEnabled\(\)/);
  assert.match(page, /await import\('\.\.\/\.\.\/_components\/TemplateRecreate'\)/);
  assert.match(page, /\{clip && TemplateRecreate && <TemplateRecreate/);
  assert.doesNotMatch(page, /^import .*TemplateRecreate/m);
  assert.match(component, /data-testid="template-recreate"/);
  assert.match(component, /writeStudioDraft/);
  assert.match(component, /templateRecreateAvailable/);
  assert.doesNotMatch(component, /fetch\(|\/api\/v1\/generations/);
});

test('all public locales contain the recreate experience copy', async () => {
  const keys = ['title', 'eyebrow', 'intro', 'videoRole', 'image1Label', 'image1Role', 'image2Label', 'image2Role', 'prompt', 'open', 'ready', 'unavailable', 'handoffError'];
  for (const locale of ['en', 'ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh']) {
    const source = await readFile(new URL(`../lib/i18n/messages/${locale}.mjs`, import.meta.url), 'utf8');
    for (const key of keys) assert.match(source, new RegExp(`"presets\\.recreate\\.${key}"\\s*:`), `${locale}:${key}`);
  }
});
