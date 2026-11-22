import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRequest, parseEndpoint } from '../packages/adapters/crun.js';
import { loadTemplateSwapDispatch } from '../lib/templateSwapClipGate.js';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { clientModelId, isPrivateModelId, TEMPLATE_SWAP_CRUN_1080_MODEL as HD, TEMPLATE_SWAP_CRUN_MODEL as SD } from '../lib/privateModelIds.js';

const inputs = { prompt: 'Change the dancer in @Video1 to @Element1.', duration_seconds: 5, video_url: 'https://r2.test/clip.mp4',
  elements: [{ frontal_image_url: 'https://r2.test/1.png', reference_image_urls: ['https://r2.test/2.png'] }] };
const pub = { id: 'kling-o1-reference', provider: 'fal', modality: 'video-to-video', credits_5s: 47 };
const row = (id, endpoint, over = {}) => ({ id, provider: 'crun', provider_endpoint: endpoint, modality: 'video-to-video', credits_5s: 47, gated_flag: false, active: true, ...over });
const sd = row(SD, 'crun:kling/o1-r2v'), hd = row(HD, 'crun:kling/o1-r2v-1080');
const env = on => ({ APP_RUNTIME_FLAGS: on ? '{"templateSwapCrun1080":true}' : '{}' });
const dispatch = async (rows, on) => { const filters = []; const out = await loadTemplateSwapDispatch(pub, {}, { env: env(on), read: async (_t, q) => { filters.push(q.filter); return rows; } }); return { out, filters }; };

test('the 1080p endpoint sends Crun the same model at 1080p; the 720p request is unchanged', () => {
  const high = buildRequest(parseEndpoint('crun:kling/o1-r2v-1080'), inputs), low = buildRequest(parseEndpoint('crun:kling/o1-r2v'), inputs);
  assert.equal(high.body.model, 'kling/o1-r2v'); assert.equal(high.body.input.resolution, '1080p');
  assert.equal(low.body.model, 'kling/o1-r2v'); assert.equal(low.body.input.resolution, '720p');
  assert.deepEqual({ ...high.body.input, resolution: '720p' }, low.body.input);
  assert.equal(capabilityFor('crun:kling/o1-r2v-1080').fixed.resolution, '1080p');
});

test('key off reads and dispatches only the 720p row, even when the 1080p row is active', async () => {
  const { out, filters } = await dispatch([sd, hd], false);
  assert.equal(out.row.id, SD); assert.deepEqual(filters, [`id=eq.${SD}`]);
});

test('key on picks 1080p; absent or inactive falls back to 720p; a mismatch refuses; 720p off stops both', async () => {
  assert.equal((await dispatch([sd, hd], true)).out.row.id, HD);
  assert.equal((await dispatch([sd], true)).out.row.id, SD);
  assert.equal((await dispatch([sd, { ...hd, active: false }], true)).out.row.id, SD);
  assert.equal((await dispatch([sd, { ...hd, credits_5s: 46 }], true)).out.ok, false);
  assert.equal((await dispatch([{ ...sd, active: false }, hd], true)).out.row.id, pub.id);
});

test('the 1080p row stays private and replay keeps the row a job was admitted on', () => {
  assert.equal(isPrivateModelId(HD), true); assert.equal(clientModelId(HD), 'kling-o1-reference');
  assert.match(readFileSync(new URL('../lib/templateSwapClipReplay.js', import.meta.url), 'utf8'), /\[TEMPLATE_SWAP_CRUN_1080_MODEL\]: TEMPLATE_SWAP_CRUN_1080_ENDPOINT/);
});

test('migration 0580 records the measured cost inside the 47-credit floor', () => {
  const sql = readFileSync(new URL('../packages/db/schema/supabase/0580_kling_o1_swap_crun_1080.sql', import.meta.url), 'utf8');
  assert.match(sql, /'crun:kling\/o1-r2v-1080', 'video-to-video', 47, 0\.6553/);
  assert.ok(135 / 206 < 47 * 0.01796);
});
