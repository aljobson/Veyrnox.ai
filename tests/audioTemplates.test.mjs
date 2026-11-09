import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';
import { ALL_TEMPLATES } from '../app/veyrnox/_lib/templates.js';
import { AUDIO_TEMPLATES, AUDIO_CATEGORIES, audioTemplateById, audioTemplatesIn } from '../app/veyrnox/_lib/audioTemplates.js';
import { TEMPLATE_ID_RE } from '../lib/clientTemplates.js';

const KIND_BY_CATEGORY = { MUSIC: 'music', 'VOICE-OVER': 'voice-over', 'SOUND FX': 'sound-effect' };
const NEGATIVE_MAX = 2000;

test('ten audio templates in each of the three categories', () => {
  assert.equal(AUDIO_TEMPLATES.length, 30);
  for (const category of AUDIO_CATEGORIES) assert.equal(audioTemplatesIn(category).length, 10, category);
});

test('ids are unique, well formed, and collide with no video template', () => {
  const video = new Set(ALL_TEMPLATES.map((t) => t.id));
  const seen = new Set();
  for (const t of AUDIO_TEMPLATES) {
    assert.match(t.id, TEMPLATE_ID_RE, t.id);
    assert.ok(!seen.has(t.id), `duplicate ${t.id}`);
    assert.ok(!video.has(t.id), `${t.id} collides with a video template`);
    seen.add(t.id);
    assert.equal(audioTemplateById(t.id), t);
  }
});

test('every template names an audio model that exists and fits its prompt limit', () => {
  for (const t of AUDIO_TEMPLATES) {
    const model = MODELS.find((m) => m.id === t.modelId);
    assert.ok(model, `${t.id}: ${t.modelId} is not in MODELS`);
    assert.equal(model.kind, 'audio', t.id);
    assert.equal(KIND_BY_CATEGORY[t.category], t.kind, `${t.id}: category/kind mismatch`);
    assert.equal(Boolean(model.speech), t.kind === 'voice-over', `${t.id}: speech model only for voice-over`);
    assert.ok(typeof t.prompt === 'string' && t.prompt.trim().length > 20, `${t.id}: empty prompt`);
    if (model.promptMax) assert.ok(t.prompt.length <= model.promptMax, `${t.id}: ${t.prompt.length} > ${model.promptMax}`);
    if (t.negativePrompt) {
      assert.equal(t.modelId, 'mmaudio-v2', `${t.id}: only MMAudio takes a negative prompt`);
      assert.ok(t.negativePrompt.length <= NEGATIVE_MAX, t.id);
    }
  }
});

test('a template carries no price and no media requirement', () => {
  for (const t of AUDIO_TEMPLATES) {
    assert.ok(!('credits' in t) && !('price' in t), `${t.id} must be priced from the live catalog`);
    assert.ok(!('media' in t), `${t.id} needs no uploads`);
  }
});

test('prompts name no brand, artist or voice clone', () => {
  const banned = /\b(spotify|netflix|disney|marvel|pixar|taylor swift|beyonc|drake|clone[sd]? (?:of )?(?:my |a |the )?voice|in the style of)\b/i;
  for (const t of AUDIO_TEMPLATES) assert.ok(!banned.test(`${t.name} ${t.prompt}`), t.id);
});

test('every audio template id is a known /presets page, and an unknown id still is not', async () => {
  const { isUnknownStaticPage } = await import('../lib/unknownStaticPage.js');
  for (const t of AUDIO_TEMPLATES) assert.equal(isUnknownStaticPage(`/presets/${t.id}`), false, t.id);
  assert.equal(isUnknownStaticPage('/presets/audio-not-a-template'), true);
});
