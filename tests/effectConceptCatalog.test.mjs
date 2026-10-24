import test from 'node:test';
import assert from 'node:assert/strict';
import { EFFECT_CONCEPTS } from '../app/veyrnox/_lib/effectConceptCatalog.js';
import { EFFECT_CONCEPT_TEMPLATES } from '../app/veyrnox/_lib/effectConceptTemplates.js';
import { PRESETS, searchTemplates, templateById } from '../app/veyrnox/_lib/templates.js';

test('the reference concept inventory stays deduplicated but is not a public template catalog', () => {
  assert.equal(EFFECT_CONCEPTS.length, 1036);
  assert.equal(EFFECT_CONCEPT_TEMPLATES.length, 1036);
  assert.equal(new Set(EFFECT_CONCEPTS.map((concept) => concept.name)).size, EFFECT_CONCEPTS.length);
  assert.equal(PRESETS.length, 142);
  assert.equal(PRESETS.some((preset) => preset.id.startsWith('effect-')), false);
});

test('concepts without videos are absent from lookup and search', () => {
  for (const id of ['effect-pet-press-conference', 'effect-voxel-world']) {
    assert.equal(templateById(id), null);
    assert.deepEqual(searchTemplates(PRESETS, id.replaceAll('-', ' ')), []);
  }
});

test('effect catalog ships no source branding, prompts or media addresses', () => {
  const publicData = JSON.stringify(EFFECT_CONCEPTS);
  const publicNames = EFFECT_CONCEPTS.map((concept) => concept.name).join('\n');
  assert.doesNotMatch(publicData, /crun|kling|vidu|bytedance|https?:|preview|prompt|video_url|cover_url/i);
  assert.doesNotMatch(publicData, /barbie|ghibli|minecraft|superman|super mario|sexy\b|boob|chanel|ferrari|doraemon|hulk|captain america|squid game|demon slayer|neymar/i);
  assert.doesNotMatch(publicNames, /(?:360p|480p|720p|1080p|[-_ ](?:img|image|video))$/im);
});
