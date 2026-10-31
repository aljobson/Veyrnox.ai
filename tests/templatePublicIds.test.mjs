import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL_TEMPLATES, LEGACY_TEMPLATE_IDS, templateById } from '../app/veyrnox/_lib/templates.js';
import { SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import { publicTemplateId } from '../app/veyrnox/_lib/templateIds.js';
import { exactSourcePromptRecord } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { toPublicPresets } from '../lib/publicPresets.js';
import { isUnknownStaticPage } from '../lib/unknownStaticPage.js';

// Nothing a visitor or the phone app receives names a source platform.
const PLATFORM = /higgs|syntx|lipsync/i;

test('published template ids, fields and clip files name no source platform', () => {
  for (const template of ALL_TEMPLATES) {
    assert.doesNotMatch(template.id, PLATFORM, template.id);
    assert.equal('sourcePlatform' in template, false, template.id);
    assert.equal('sourceUrl' in template, false, template.id);
  }
  for (const [key, clip] of Object.entries(SHOWCASE_CLIPS)) {
    for (const path of [clip.video, clip.poster].filter(Boolean)) assert.doesNotMatch(path, PLATFORM, key);
  }
  const feed = JSON.stringify(toPublicPresets([]));
  assert.doesNotMatch(feed, PLATFORM);
});

test('every old id still resolves to its renamed template and reaches the redirect', () => {
  assert.equal(LEGACY_TEMPLATE_IDS.length, 122);
  for (const legacy of LEGACY_TEMPLATE_IDS) {
    const template = templateById(legacy);
    assert.ok(template, legacy);
    assert.equal(template.id, publicTemplateId(legacy));
    assert.equal(isUnknownStaticPage(`/presets/${legacy}`), false, legacy);
  }
  assert.equal(templateById('seedance-higgs-868ea6d0').id, 'seedance-868ea6d0');
  assert.equal(templateById('seedance-syntx-jean-phil').id, 'seedance-jean-phil');
});

test('source records stay readable by the published id', () => {
  const record = exactSourcePromptRecord('seedance-jean-phil');
  assert.ok(record?.prompt);
  assert.equal(record, exactSourcePromptRecord('seedance-syntx-jean-phil'));
});

test('old template addresses redirect permanently, with or without a language prefix', () => {
  const config = readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8');
  assert.match(config, /source: '\/presets\/seedance-:platform\(higgs\|syntx\)-:rest\(\[a-z0-9-\]\+\)', destination: '\/presets\/seedance-:rest', permanent: true/);
  assert.match(config, /source: '\/:locale\(\[a-z\]\[a-z\]\)\/presets\/seedance-:platform\(higgs\|syntx\)-:rest\(\[a-z0-9-\]\+\)', destination: '\/:locale\/presets\/seedance-:rest', permanent: true/);
});
