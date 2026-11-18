import test from 'node:test';
import assert from 'node:assert/strict';
import { templateSwapAvailable, loadTemplateSwapClip } from '../lib/templateSwapClipGate.js';
import { resolveTemplateSwapVideo } from '../lib/templateSwapClipGeneration.js';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { id, registry, manifest, catalog } from './fixtures/templateSwapClips.mjs';
const env = { MULTI_REFERENCE_ENABLED: 'true', TEMPLATE_SWAP_CLIP_ENABLED: 'true' };
const options = { env, registry, manifest, catalog };
test('availability returns only a registered swap on the exact active catalog offer', async () => {
  const result = templateSwapAvailable(id, options);
  assert.deepEqual(result.template, { id, model: 'kling-o1-reference', credits: 47, durationSeconds: 5, role: 'the main character', images: 2 });
  assert.deepEqual(await loadTemplateSwapClip(id, {}, { ...options, read: async () => catalog, readManifest: async () => manifest }), result);
  for (const value of [undefined, true, 'TRUE', 'false']) assert.equal(templateSwapAvailable(id, { ...options, env: { TEMPLATE_SWAP_CLIP_ENABLED: value } }), null);
  for (const patch of [{ active: false }, { active: 'true' }, { gated_flag: 'flag' }, { provider: 'kie' }, { provider_endpoint: 'wrong' }, { credits_5s: 0 }, { credits_5s: 1.5 }]) {
    assert.equal(templateSwapAvailable(id, { ...options, catalog: [{ ...catalog[0], ...patch }] }), null);
  }
  for (const other of ['unknown', 'medieval-runway-look', '__proto__']) assert.equal(templateSwapAvailable(other, { ...options, registry: [other], manifest: { [other]: manifest[id] } }), null);
  assert.equal(templateSwapAvailable(id, { ...options, registry: [] }), null);
  assert.equal(templateSwapAvailable(id, { ...options, manifest: {} }), null);
});
test('both lengths are bounded at the 5 s price unit (+0.05 tolerance) in gate and admission', async () => {
  const record = capabilityFor(catalog[0].provider_endpoint);
  for (const field of ['seconds', 'videoSeconds']) for (const value of [2.99, 3, 5, 5.05, 5.06, 7, 10, 10.02]) {
    const source = { ...manifest[id], [field]: value };
    const clip = { template: { id }, source };
    const valid = value >= 3 && value <= 5.05;
    assert.equal(!!templateSwapAvailable(id, { ...options, manifest: { [id]: source } }), valid);
    const resolved = await resolveTemplateSwapVideo(clip, record, {}, async (key, ttl) => {
      assert.equal(valid, true); assert.equal(key, source.key); assert.equal(ttl, 900); return { url: 'signed' };
    });
    assert.equal(resolved.ok, valid);
  }
  for (const patch of [{ width: 719 }, { height: 2161 }, { version: '' }, { sha256: 'x' }, { key: 'wrong' }, { contentType: 'video/webm' }, { sizeBytes: 0 }, { frameRate: 0 }]) {
    assert.equal(templateSwapAvailable(id, { ...options, manifest: { [id]: { ...manifest[id], ...patch } } }), null);
  }
});

test('a video-blocked template is available only through the clip path and still refused without it', async () => {
  const { swapCandidates } = await import('../scripts/import-template-swap-clips.mjs');
  const { checkTemplateRequest } = await import('../lib/templateFidelity.js');
  const blocked = (await swapCandidates({ kinds: ['video_swap', 'motion'] }))[0];
  const source = { ...manifest[id], key: `template-swap-clips/${blocked.id}/${manifest[id].sha256}.mp4` };
  const open = { ...options, registry: [blocked.id], manifest: { [blocked.id]: source } };
  assert.ok(templateSwapAvailable(blocked.id, open));
  assert.equal(templateSwapAvailable(blocked.id, { ...open, registry: [] }), null);
  assert.equal(checkTemplateRequest({ template_id: blocked.id, model_id: 'kling-3.0-i2v', inputs: { prompt: blocked.sourcePrompt } }).error, 'template_blocked');
});
