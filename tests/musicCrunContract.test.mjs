import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CRUN_SUNO_LIMITS, MUSIC_CRUN_CONTRACT, MUSIC_CRUN_JSON_MAX_BYTES,
  MUSIC_CRUN_MAX_TEXT_UTF8_BYTES, crunEntitlement, crunStyleWeight,
  crunVarietyBucket, musicVersionCapabilities, parseCrunMusicDraft, parseCrunMusicQuote,
} from '../lib/musicCrunContract.js';
import { musicEntitlementProjection, readMusicJson } from '../lib/musicBackend.js';
import { readFreshMusicCatalog } from '../lib/publicCatalog.js';

const DRAFT_ID = '92ed2d0d-8276-4fbb-9c4f-39f401a3158b';

test('Crun offer contracts expose only the controls and limits the offer accepts', () => {
  const base = crunEntitlement({ id: 'ace-step' });
  const premium = crunEntitlement({ id: 'ace-step-1.5' });
  assert.equal(base.provider_contract, MUSIC_CRUN_CONTRACT);
  assert.deepEqual(base.generation_modes, ['simple']);
  assert.equal(base.instrumental_only, true);
  assert.equal(base.requires_paid_plan, false);
  assert.deepEqual(base.controls.suno_model, ['v6']);
  assert.equal(base.controls.tempo_key_meter, false);
  assert.deepEqual(premium.generation_modes, ['simple', 'custom']);
  assert.equal(premium.requires_paid_plan, true);
  assert.equal(premium.controls.lyrics_required_for_custom_vocal, true);
  assert.equal(premium.limits, CRUN_SUNO_LIMITS);
  assert.equal(premium.counters.exclude_styles.applied, 200);
});

test('Crun mappings preserve the public 0..100 controls at every bucket edge', () => {
  assert.deepEqual([0, 13, 38, 63, 88, 100].map(crunVarietyBucket), [0, 1, 2, 3, 4, 4]);
  assert.deepEqual([0, 25, 100].map(crunStyleWeight), [0, 0.25, 1]);
});

test('Crun quote validation rejects fal-only controls and validates each frozen field', () => {
  const simple = parseCrunMusicQuote({ prompt: 'Harbour lights', instrumental: true });
  assert.equal(simple.ok, true);
  assert.equal(simple.providerMode, 'simple');
  assert.equal(parseCrunMusicQuote({ prompt: 'x', instrumental: false }).error, 'instrumental_required');
  assert.equal(parseCrunMusicQuote({ prompt: 'x', bpm: 120 }).error, 'advanced_controls_invalid');
  assert.equal(parseCrunMusicQuote({ prompt: 'x', model_id: 'ace-step-1.5', duration_seconds: 20 }).providerMode, 'custom');
  assert.equal(parseCrunMusicQuote({ prompt: 'x', model_id: 'ace-step-1.5', vocal_gender: 'female' }).error, 'vocal_gender_invalid');

  const controls = {
    mode: 'custom', provider_contract: MUSIC_CRUN_CONTRACT, draft_id: DRAFT_ID,
    draft_revision: 7, instrumental: false, rights_confirmed: true, duration_seconds: 360,
    suno_model: 'v6_wild', vocal_gender: 'female', style_influence: 75,
    weirdness: 0.625, variety: 88, exclude_styles: 'noise',
  };
  const parsed = parseCrunMusicQuote(controls);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.varietyBucket, 4);
  assert.equal(parsed.styleWeight, 0.75);
  for (const [key, value, error] of [
    ['suno_model', 'v5', 'suno_model_invalid'],
    ['vocal_gender', 'robot', 'vocal_gender_invalid'],
    ['style_influence', 101, 'style_influence_invalid'],
    ['weirdness', 1.1, 'weirdness_invalid'],
    ['variety', -1, 'variety_invalid'],
    ['duration_seconds', 361, 'duration_invalid'],
  ]) assert.equal(parseCrunMusicQuote({ ...controls, [key]: value }).error, error, key);
});

test('custom vocal quotes require saved lyrics and multibyte draft limits count characters', () => {
  const exact = parseCrunMusicDraft({
    provider_contract: MUSIC_CRUN_CONTRACT, draft_id: DRAFT_ID, revision: 0,
    model_id: 'ace-step-1.5', lyrics: '🎵'.repeat(5000), styles: '🎸'.repeat(1000), title: '🌟'.repeat(80),
  });
  assert.equal(exact.ok, true);
  assert.equal(parseCrunMusicDraft({ ...exact, provider_contract: MUSIC_CRUN_CONTRACT }).ok, false,
    'normalized output is not accepted as a wire request');
  const base = {
    provider_contract: MUSIC_CRUN_CONTRACT, draft_id: DRAFT_ID, revision: 0,
    model_id: 'ace-step-1.5', lyrics: '', styles: '', title: '',
  };
  assert.equal(parseCrunMusicDraft({ ...base, lyrics: '🎵'.repeat(5001) }).error, 'lyrics_invalid');
  assert.equal(parseCrunMusicDraft({ ...base, styles: '🎸'.repeat(1001) }).error, 'styles_invalid');
});

test('the expanded JSON ceiling covers four-byte text and escaped JSON worst cases', async () => {
  assert.equal(MUSIC_CRUN_MAX_TEXT_UTF8_BYTES, 28_320);
  assert.ok(MUSIC_CRUN_JSON_MAX_BYTES > MUSIC_CRUN_MAX_TEXT_UTF8_BYTES);
  assert.ok(MUSIC_CRUN_JSON_MAX_BYTES > 7_080 * 6);
  assert.ok(MUSIC_CRUN_JSON_MAX_BYTES > 7_080 * 12);
  const multibyteAt = JSON.stringify({ x: '🎵'.repeat((MUSIC_CRUN_JSON_MAX_BYTES - 8) / 4) });
  assert.equal(Buffer.byteLength(multibyteAt), MUSIC_CRUN_JSON_MAX_BYTES);
  assert.equal((await readMusicJson(new Request('https://x.invalid', { method: 'POST', body: multibyteAt }), MUSIC_CRUN_JSON_MAX_BYTES)).ok, true);
  const multibyteOver = JSON.stringify({ x: `${'🎵'.repeat((MUSIC_CRUN_JSON_MAX_BYTES - 8) / 4)}🎵` });
  assert.equal((await readMusicJson(new Request('https://x.invalid', { method: 'POST', body: multibyteOver }), MUSIC_CRUN_JSON_MAX_BYTES)).error, 'body_too_large');
  const jsonAt = JSON.stringify({ x: 'a'.repeat(MUSIC_CRUN_JSON_MAX_BYTES - 8) });
  assert.equal(Buffer.byteLength(jsonAt), MUSIC_CRUN_JSON_MAX_BYTES);
  assert.equal((await readMusicJson(new Request('https://x.invalid', { method: 'POST', body: jsonAt }), MUSIC_CRUN_JSON_MAX_BYTES)).ok, true);
  const jsonOver = JSON.stringify({ x: `a${'a'.repeat(MUSIC_CRUN_JSON_MAX_BYTES - 8)}` });
  const over = await readMusicJson(new Request('https://x.invalid', { method: 'POST', body: jsonOver }), MUSIC_CRUN_JSON_MAX_BYTES);
  assert.deepEqual(over, { ok: false, error: 'body_too_large' });
});

test('fresh music catalog reads observe activation and rollback on the first response', async () => {
  let endpoint = 'crun:suno/music-generate';
  const selectRows = async () => [{
    id: 'ace-step', name: 'ACE-Step', modality: 'text-to-audio', credits_5s: endpoint.startsWith('crun:') ? 4 : 2,
    gated_flag: false, provider: endpoint.startsWith('crun:') ? 'crun' : 'fal', provider_endpoint: endpoint,
    updated_at: endpoint.startsWith('crun:') ? '2026-11-22T15:00:00Z' : '2026-11-22T16:00:00Z',
  }];
  const cfg = { supabaseUrl: 'https://fixture.invalid', serviceRoleKey: 'fixture' };
  const active = await readFreshMusicCatalog({ cfg, selectRows });
  endpoint = 'fal-ai/ace-step';
  const rolledBack = await readFreshMusicCatalog({ cfg, selectRows });
  assert.deepEqual([active[0].provider_contract, active[0].credits], [MUSIC_CRUN_CONTRACT, 4]);
  assert.deepEqual([rolledBack[0].provider_contract, rolledBack[0].credits], ['fal-ace-v1', 2]);
});

test('entitlements use the active contract table and catalog price', () => {
  const result = musicEntitlementProjection({
    models: [{ id: 'ace-step', name: 'ACE-Step', modality: 'text-to-audio', credits: 4,
      gated: false, provider_contract: MUSIC_CRUN_CONTRACT }],
    credits: { balance: 20 }, generationEnabled: true, subscription: null,
  });
  assert.equal(result.models[0].provider_contract, MUSIC_CRUN_CONTRACT);
  assert.equal(result.models[0].credits_per_candidate, 4);
  assert.equal(result.models[0].total_credits, 4);
  assert.equal(result.models[0].controls.tempo_key_meter, false);
  assert.equal(result.models[0].name, 'Veyrnox Music');
  assert.deepEqual(result.models[0].controls.suno_model_labels, { v6: 'Balanced' });
  assert.equal(result.models[0].id, 'ace-step');
});

test('entitlements fail closed for the shared account, endpoint and selected Suno-model breakers', () => {
  const models = [
    { id: 'ace-step', name: 'Base', modality: 'text-to-audio', credits: 4, gated: false, provider_contract: MUSIC_CRUN_CONTRACT },
    { id: 'ace-step-1.5', name: 'Premium', modality: 'text-to-audio', credits: 4, gated: false, provider_contract: MUSIC_CRUN_CONTRACT },
  ];
  const project = (crunAvailability) => musicEntitlementProjection({ models, credits: { balance: 20 },
    generationEnabled: true, subscription: { status: 'active', current_period_end: '2099-01-01T00:00:00Z' }, crunAvailability });
  for (const unavailable of [
    { admission_open: false, endpoint_open: true, suno_models: { v6: true, v6_mini: true, v6_wild: true } },
    { admission_open: true, endpoint_open: false, suno_models: { v6: true, v6_mini: true, v6_wild: true } },
  ]) assert.ok(project(unavailable).models.every((model) => model.available === false));

  const perModel = project({ admission_open: true, endpoint_open: true,
    suno_models: { v6: false, v6_mini: true, v6_wild: false } });
  assert.equal(perModel.models[0].available, false);
  assert.equal(perModel.models[1].available, true);
  assert.deepEqual(perModel.models[1].controls.suno_model, ['v6_mini']);
  assert.deepEqual(perModel.models[1].controls.suno_model_labels, { v6_mini: 'Fast' });
  assert.deepEqual(Object.keys(perModel.models[1].controls.suno_model_labels), perModel.models[1].controls.suno_model);
});

test('song projection keeps an asset-less row and makes every capability null-safe', async () => {
  const sql = await readFile(new URL('../packages/db/schema/supabase/0593_crun_suno_quote_controls.sql', import.meta.url), 'utf8');
  const song = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.music_get_song'),
    sql.indexOf('CREATE OR REPLACE FUNCTION public.music_get_remix_source_context'));
  assert.match(song, /LEFT JOIN public\.assets ca ON ca\.id=cv\.audio_asset_id/);
  const capabilities = [...song.matchAll(/'(playback|download|render|crop|remix|mashup|sample|stems|target_stem|track_add|cover|extend|replace_section|add_section)',([^\n]+)/g)];
  assert.equal(capabilities.length, 14);
  assert.ok(capabilities.every(([, , expression]) => expression.includes('COALESCE(') && expression.includes(',false)')));
});

test('quote route rejects an unknown model before configuration or catalog access', async () => {
  const source = await readFile(new URL('../app/api/v1/music/generation-quotes/route.js', import.meta.url), 'utf8');
  const validation = source.indexOf("return reply({ error: 'model_not_supported' }, 400)");
  assert.ok(validation > 0);
  assert.ok(validation < source.indexOf('const cfg = envConfig()'));
  assert.ok(validation < source.indexOf('await readFreshMusicCatalog'));
});

test('current-version action matrix is MIME and size based, never provider based', () => {
  const wav = musicVersionCapabilities({ mimeType: 'audio/wav', sizeBytes: 26_214_400 });
  assert.equal(wav.render, true); assert.equal(wav.crop, true); assert.equal(wav.remix, true);
  assert.equal(wav.stems, false); assert.equal(wav.track_add, false); assert.equal(wav.cover, true);
  const largeWav = musicVersionCapabilities({ mimeType: 'audio/wav', sizeBytes: 26_214_401 });
  assert.equal(largeWav.render, false); assert.equal(largeWav.remix, false); assert.equal(largeWav.cover, true);
  const mp3 = musicVersionCapabilities({ mimeType: 'audio/mpeg', sizeBytes: 10_485_760 });
  assert.equal(mp3.render, false); assert.equal(mp3.stems, true); assert.equal(mp3.track_add, true);
  assert.equal(mp3.cover, true); assert.equal(mp3.extend, true); assert.equal(mp3.replace_section, true); assert.equal(mp3.add_section, true);
  assert.equal(musicVersionCapabilities({ mimeType: 'audio/mpeg', sizeBytes: 10_485_761 }).track_add, false);
  assert.equal(musicVersionCapabilities({ mimeType: 'audio/mpeg', sizeBytes: 10_485_761 }).stems, false);
  assert.equal(musicVersionCapabilities({ mimeType: 'audio/mp3', sizeBytes: 100 }).stems, true);
  assert.equal(musicVersionCapabilities({ mimeType: 'audio/mp3', sizeBytes: 100 }).cover, false);
});

test('only draft, quote and generation routes opt into the expanded body ceiling', async () => {
  const files = await Promise.all([
    'app/api/v1/music/drafts/custom/route.js',
    'app/api/v1/music/generation-quotes/route.js',
    'app/api/v1/music/generations/route.js',
  ].map((path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));
  for (const source of files) assert.match(source, /readMusicJson\(request, MUSIC_CRUN_JSON_MAX_BYTES\)/);
});

test('control characters are refused in every free-text field, tabs and newlines stay allowed', () => {
  const simple = { provider_contract: MUSIC_CRUN_CONTRACT, model_id: 'ace-step', instrumental: true };
  assert.deepEqual(parseCrunMusicQuote({ ...simple, prompt: 'a\u0000b' }), { ok: false, error: 'prompt_invalid' });
  assert.deepEqual(parseCrunMusicQuote({ ...simple, prompt: 'a\u001fb' }), { ok: false, error: 'prompt_invalid' });
  assert.deepEqual(parseCrunMusicQuote({ ...simple, prompt: 'ok', title: 'x\u0000' }), { ok: false, error: 'title_invalid' });
  assert.equal(parseCrunMusicQuote({ ...simple, prompt: 'two\nlines\tand a tab' }).ok, true);
  const premium = { ...simple, model_id: 'ace-step-1.5', prompt: 'ok' };
  assert.equal(parseCrunMusicQuote({ ...premium, exclude_styles: 'lo-fi, trap' }).ok, true);
  assert.deepEqual(parseCrunMusicQuote({ ...premium, exclude_styles: 'lo-fi\u0000' }), { ok: false, error: 'exclude_styles_invalid' });
  const draft = { provider_contract: MUSIC_CRUN_CONTRACT, draft_id: DRAFT_ID, revision: 0, model_id: 'ace-step-1.5', lyrics: 'la', styles: 'pop', title: 't' };
  assert.equal(parseCrunMusicDraft(draft).ok, true);
  assert.deepEqual(parseCrunMusicDraft({ ...draft, lyrics: 'la\u0000' }), { ok: false, error: 'lyrics_invalid' });
  assert.deepEqual(parseCrunMusicDraft({ ...draft, styles: 'p\u0007' }), { ok: false, error: 'styles_invalid' });
  assert.deepEqual(parseCrunMusicDraft({ ...draft, title: '\u0000' }), { ok: false, error: 'title_invalid' });
});
