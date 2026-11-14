import { contractData } from '../lib/expandTemplateContract.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { bind, imageSlots } from '../lib/templateBinding.js';
import { templateVideoDependency } from '../lib/templateVideoDependency.js';
import { templateAudioDependency } from '../lib/templateAudioDependency.js';
import { audit, auditTemplate } from '../scripts/audit-template-fidelity.mjs';
import { PRESETS } from '../app/veyrnox/_lib/templates.js';
import { templateContract } from '../lib/templateContract.js';
import { templateModelId, MODELS, presetCredits, presetHref } from '../app/veyrnox/_lib/tokens.js';
import { templateRoute } from '../lib/templateContract.js';
import { templateArrival, draftForTemplate } from '../app/veyrnox/_lib/templateDraft.js';
import { templateStartIdFor } from '../lib/templateStartCheck.js';
import { toPublicPresets } from '../lib/publicPresets.js';
import { fallbackCapabilitiesFor } from '../lib/fallbackModelCapabilities.js';
import { templateInputs, submitTemplate, templateRun } from '../app/veyrnox/_lib/templateGenerate.js';
import { checkTemplateRequest } from '../lib/templateFidelity.js';
const sha = text => createHash('sha256').update(text).digest('hex');
for (const token of ['@image1', '@Image 1', '@IMAGE_1', '@image-1', '<<<image_1>>>', '<<< IMAGE 1 >>>', '<<<image-1>>>', 'Image 1:', 'image_1.png', 'image-1.jpeg']) {
  test(`binding grammar: ${token}`, () => {
    const source = ` \r\nProduct ${token}\tVehicle ${token}\r\n `;
    const result = bind(source, 1);
    assert.equal(result.text, ` \r\nProduct @Image1${token === 'Image 1:' ? ':' : ''}\tVehicle @Image1${token === 'Image 1:' ? ':' : ''}\r\n `);
    assert.deepEqual(result.map.map(m => m.slot), [1, 1]);
    assert.equal(bind(result.text, 1).text, result.text);
    assert.equal(bind(source, 1, 'kling-3.0-i2v').error, 'unsupported-binding-model');
  });
}
test('first-appearance slots, repeated aliases, invalid tokens and exact counts', () => {
  assert.equal(bind('@image9 @image2 <<<image_9>>>', 2).text, '@Image1 @Image2 @Image1');
  for (const source of ['', '@image0', '@image1 <person>', '@image1 @imageOne', Array.from({ length: 10 }, (_, i) => `@image${i + 1}`).join(' ')]) assert.ok(bind(source, imageSlots(source).length).error, source);
  assert.equal(bind('@image1', 2).error, 'image-slot-count-mismatch');
});
test('shared detectors distinguish source dependencies from generated or negated sound', () => {
  for (const text of ['Keep the original video’s choreography', 'same motion as the reference video', '@Video 1', '<<<video_2>>>', 'video_1.mp4']) assert.equal(templateVideoDependency(text), true, text);
  for (const text of ['Preserve the original environment and camera movement', 'Custom landscape', 'Generate camera movement through a new city']) assert.equal(templateVideoDependency(text), false, text);
  for (const text of ['Preserve the original audio exactly', 'Use source vocals', 'Use @audio1']) assert.equal(templateAudioDependency(text), true, text);
  for (const text of ['Dialogue: None', 'No music', 'Generate native synced audio', 'Dialogue: Hello there', 'Do not infer or generate any audio from @video1', 'No audio reference', 'Create a music video']) assert.equal(templateAudioDependency(text), false, text);
});
test('audit classification, reasons, source hashes and non-token bytes are locked', () => {
  const report = audit();
  assert.deepEqual(report.totals, {"like-for-like-safe":232 + 0,"bound":162 + 9,"blocked-needs-video":355 + 37,"unsupported":0});
  assert.deepEqual(report.unsupportedReasons, {});
  for (const p of PRESETS) {
    const c = report.contracts[p.id];
    if (!c) continue;
    assert.equal(c.sourceHash, sha(p.sourcePrompt));
    if (c.class !== 'bound') { assert.equal(c.prompt, p.sourcePrompt); continue; }
    assert.ok(c.slotCount >= 1 && c.slotCount <= 9);
    assert.equal(c.boundHash, sha(c.prompt));
    let cursor = 0, output = '';
    for (const m of c.tokenMap) {
      assert.equal(p.sourcePrompt.slice(m.offset, m.offset + m.token.length), m.token);
      output += p.sourcePrompt.slice(cursor, m.offset) + m.target;
      cursor = m.offset + m.token.length;
    }
    assert.equal(output + p.sourcePrompt.slice(cursor), c.prompt);
  }
  const synthetic = { id: 'a2-synthetic', model: 'Kling 3.0 · I2V', sourcePrompt: '@image1', durationSeconds: 5 };
  assert.ok(auditTemplate({ ...synthetic, aspect: '2:3' }).reasons.includes('unsupported-aspect'));
  assert.ok(auditTemplate({ ...synthetic, durationSeconds: 15 }).reasons.includes('unsupported-duration'));
  assert.ok(auditTemplate({ ...synthetic, sourcePrompt: '@image1 Preserve the original audio.' }).reasons.includes('source-audio-not-audited'));
});
test('default feed/detail/Create routing, price, attribution and exact-count admission agree', async () => {
  for (const p of PRESETS) {
    const c = templateContract(p.id);
    if (c?.class !== 'bound') continue;
    const id = templateModelId(p), cap = fallbackCapabilitiesFor(id);
    const model = { ...MODELS.find(m => m.id === id), modality: cap.media.image ? 'image-to-video' : 'text-to-video', aspects: cap.inputs.aspect_ratio?.values, credits: 91 };
    const [feed] = toPublicPresets([model], [p]);
    const href = new URL(presetHref(p), 'https://veyrnox.test');
    const arrival = templateArrival(p, [model], href.searchParams, null);
    assert.equal(feed.modelId, id); assert.equal(arrival.modelId, id);
    assert.equal(feed.modality, model.modality); assert.equal(feed.slotCount, c.slotCount);
    assert.equal(feed.credits, presetCredits(p, [model]));
    assert.equal(feed.credits, 91 * Math.ceil(p.durationSeconds / 5));
    assert.equal(feed.available, true); assert.equal(toPublicPresets([], [p])[0].available, false);
    assert.equal(draftForTemplate(p, id).prompt, c.sourcePrompt);
    assert.equal(templateStartIdFor(p.id, p, id), p.id);
    assert.equal(id, 'seedance-2.0-reference');
    const refs = [{ slot: 'image', origin: 'upload', key: 'photo' }];
    const inputs = templateInputs(p, { ...model, kind: 'video' }, { prompt: c.sourcePrompt, aspect: c.aspect, aspectOptions: c.aspect ? [c.aspect] : [], durationSeconds: c.duration, withPhoto: true });
    let body;
    await submitTemplate({ preset: p, model, inputs, run: templateRun(null, p.id, 91, () => 'key'), quote: { ceilings: [91] }, deps: { sources: async () => ({ references: refs }), gatewayFetch: async (_, init) => { body = JSON.parse(init.body); return { job_id: 'job' }; }, onJob() {} } });
    if (c.slotCount === 1) { assert.equal(body.template_id, c.id); assert.equal(body.inputs.prompt, c.prompt); assert.equal(checkTemplateRequest(body).ok, true); }
    else { assert.equal(body.template_id, undefined); assert.equal(body.inputs.prompt, c.sourcePrompt); }
    assert.equal(templateRoute(p, id, c.slotCount).modelId, 'seedance-2.0-reference');
  }
});
test('the generated contract covers all exact-source templates', () => {
  // The repository's English markup baseline exercises rendering separately.
  const { templates } = contractData(JSON.parse(readFileSync(new URL('../lib/templateFidelityContracts.json', import.meta.url))));
  assert.equal(Object.keys(templates).length, 749 + 46);
});

test('reviewed overlapping reason counts are pinned across all classes', () => {
  const counts = {};
  for (const c of Object.values(audit().contracts)) for (const reason of c.reasons) counts[reason] = (counts[reason] || 0) + 1;
  assert.deepEqual(counts, { 'reference-video-required': 355 + 37, 'source-audio-not-audited': 62 + 9, 'unmapped-image-reference': 27, 'unmapped-placeholder': 122, 'too-many-image-slots': 2 });
});

test('all bound detail pages offer exactly N fixed required slots', async t => {
  const old = process.env.MULTI_REFERENCE_ENABLED;
  process.env.MULTI_REFERENCE_ENABLED = 'true';
  t.after(() => { if (old === undefined) delete process.env.MULTI_REFERENCE_ENABLED; else process.env.MULTI_REFERENCE_ENABLED = old; });
  const React = await import('react');
  const { fixture } = await import('./helpers/publicSiteRender.mjs');
  for (const count of [1, 2, 3, 4, 5, 7, 8]) {
    const p = PRESETS.find(p => templateContract(p.id)?.slotCount === count);
    const base = MODELS.find(m => m.id === templateModelId(p));
    const cap = fallbackCapabilitiesFor(base.id);
    const model = { ...base, aspects: cap.inputs.aspect_ratio?.values, media: cap.media };
    const f = fixture('en', '/presets/' + p.id, { moduleMocks: { '../_lib/useCatalog': { useCatalog: () => ({ models: [model], live: true }) } } });
    const html = f.render(React.createElement(f.load('app/veyrnox/_components/UseTemplate.js').UseTemplate, { preset: p }));
    assert.equal((html.match(/type="file"/g) || []).length, count);
    for (let i = 1; i <= count; i++) assert.ok(html.includes(`Photo ${i}`));
    assert.ok(html.includes(`Fill all ${count} photo slots`));
    assert.doesNotMatch(html, /Use one photo of one person|Move earlier|Move later/);
  }
});
