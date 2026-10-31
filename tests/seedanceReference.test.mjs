import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityFor, publicCapabilities, checkInputs } from '../lib/modelCapabilities.js';
import { fallbackCapabilitiesFor } from '../lib/fallbackModelCapabilities.js';
import { attachCapacity, planAttachments } from '../lib/createAttach.mjs';
import { publicSlotMax } from '../lib/generationSourceSlots.mjs';
import { hardMaxFiles, verifiedReferenceLimit, MAX_REFERENCES } from '../lib/multiReference.mjs';
import { takesReferenceModel, SEEDANCE_REFERENCE_ACTIVE, SEEDANCE_REFERENCE_MODEL } from '../app/veyrnox/_lib/seedanceReference.js';
import { SOURCE_TEMPLATES } from '../app/veyrnox/_lib/sourceTemplates.js';
import { readFileSync } from 'node:fs';

const EP = 'bytedance/seedance-2.0/reference-to-video';
const record = capabilityFor(EP);
const png = n => ({ name: `${n}.png`, type: 'image/png' });

test('reference record has a verified 9-picture slot and no frame slots', () => {
  assert.equal(record.provider, 'fal');
  assert.deepEqual(Object.keys(record.media), ['image']);
  assert.ok(verifiedReferenceLimit(record.media.image));
  assert.equal(hardMaxFiles(record.media.image), 9);
  assert.ok(MAX_REFERENCES >= 12);
});

test('an unverified or oversized slot still falls back to one', () => {
  assert.equal(hardMaxFiles({ list: true, max: 9 }), 1);
  assert.equal(hardMaxFiles({ ...record.media.image, max: 10 }), 1);
});

test('gateway admits 9 pictures and refuses 10 when multi-reference is on', () => {
  process.env.MULTI_REFERENCE_ENABLED = 'true';
  try {
    const urls = n => Array.from({ length: n }, (_, i) => `https://r2.example/${i}.png`);
    assert.equal(checkInputs(record, { prompt: 'x', image_url: urls(9) }).ok, true);
    assert.equal(checkInputs(record, { prompt: 'x', image_url: urls(10) }).error, 'source_count_exceeded');
  } finally { delete process.env.MULTI_REFERENCE_ENABLED; }
});

test('fallback capabilities feed the Create attach area 9 pictures', () => {
  const caps = fallbackCapabilitiesFor('seedance-2.0-reference');
  process.env.MULTI_REFERENCE_ENABLED = 'true';
  try {
    const pub = publicCapabilities(record);
    assert.equal(publicSlotMax(pub.media.image), 9);
    assert.equal(attachCapacity({ media: pub.media }).image, 9);
    const model = { id: 'ref', kind: 'video', credits: 85, media: pub.media };
    const plan = planAttachments([model], model, Array.from({ length: 9 }, (_, i) => png(i)));
    assert.equal(plan.assignments.length, 9);
    assert.ok(caps);
  } finally { delete process.env.MULTI_REFERENCE_ENABLED; }
});

test('frame models keep their 3-per-kind cap', () => {
  const frames = { id: 'f', kind: 'video', credits: 1, media: { image: { required: true }, endImage: {} } };
  assert.equal(attachCapacity(frames).image, 2);
  assert.equal(attachCapacity(null).image, 3);
});

test('Seedance-origin Kling templates move to the reference model only when active', () => {
  const src = { sourceModel: 'Seedance 2.5', runnableModel: 'Kling 3.0 · I2V' };
  assert.equal(takesReferenceModel(src, true), true);
  assert.equal(takesReferenceModel({ ...src, sourceModel: 'Kling' }, true), false);
  assert.equal(takesReferenceModel({ ...src, runnableModel: 'Seedance 2.0 Fast' }, true), false);
  assert.equal(takesReferenceModel(src), SEEDANCE_REFERENCE_ACTIVE);
});

test('staged migration is inactive and priced at the floor', () => {
  const sql = readFileSync(new URL('../packages/db/schema/supabase/0416_seedance_reference.sql', import.meta.url), 'utf8');
  assert.match(sql, /'seedance-2\.0-reference'[\s\S]*85,1\.5120[\s\S]*false,false\)/);
  assert.ok(SOURCE_TEMPLATES.find(t => t.id === 'shadow-warriors'));
  assert.equal(SEEDANCE_REFERENCE_MODEL, 'Seedance 2.0 · Reference');
});
