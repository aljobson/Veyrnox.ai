import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { musicRuntimeFlag } from '../lib/musicRuntime.js';
import { musicEntitlementProjection, parseMusicQuote } from '../lib/musicBackend.js';
import { MUSIC_LONG_SONG_MAX, musicDurationBounds, musicDurationPriceBlocks } from '../lib/musicLongSongs.js';

const modelIds = ['ace-step', 'ace-step-1.5', 'ace-step-loop'];
const simple = modelId => ({ prompt: 'Harbour lights', model_id: modelId });
const custom = { mode: 'custom', draft_revision: 7, instrumental: false, rights_confirmed: true };
const customInstrumental = { ...custom, instrumental: true, rights_confirmed: false };
const fixture = paid => ({
  models: [
    { id: 'ace-step', name: 'ACE-Step', modality: 'text-to-audio', credits: 5, gated: false,
      capabilities: { inputs: { prompt: {}, seed: {} } } },
    { id: 'ace-step-1.5', name: 'ACE-Step 1.5', modality: 'text-to-audio', credits: 3, gated: false,
      capabilities: { inputs: { prompt: {} } } },
    { id: 'ace-step-loop', name: 'Loop', modality: 'text-to-audio', credits: 3, gated: false },
  ],
  credits: { balance: 23, free_credits: 4, free_expires_at: '2026-11-20T00:00:00Z' },
  generationEnabled: true,
  subscription: paid ? { status: 'active', current_period_end: '2026-12-19T00:00:00Z' } : null,
  now: Date.parse('2026-11-19T00:00:00Z'),
});

// Frozen pre-longSongs response, including property order for serialized compatibility.
const previousEntitlements = paid => ({
  available: true, mode: 'simple', output_count: 1, concurrency_limit: 4,
  balance: 23, free_credits: 4, free_expires_at: '2026-11-20T00:00:00Z',
  models: [{
    generation_modes: ['simple'],
    controls: {
      description: true, seed: true, variety: false, style_influence: false,
      exclude_styles: false, tempo_key_meter: false,
      duration_seconds: { min: 10, max: 60, default: 60 },
      lyrics: false, styles: false, instrumental: 'required',
    },
    id: 'ace-step', name: 'ACE-Step', credits_per_candidate: 5, total_credits: 5,
    instrumental_only: true, requires_paid_plan: false, available: true,
  }, {
    generation_modes: ['simple', 'custom'],
    controls: {
      description: true, seed: false, variety: true, style_influence: true,
      exclude_styles: true, tempo_key_meter: true,
      duration_seconds: { min: 10, max: 60, default: 60 },
      lyrics: true, styles: true, instrumental: 'optional',
    },
    id: 'ace-step-1.5', name: 'ACE-Step 1.5', credits_per_candidate: 3, total_credits: 3,
    instrumental_only: false, requires_paid_plan: true, available: paid,
  }],
  custom_drafts: {
    available: true, autosave: true, generation_supported: paid,
    lyrics_max: 3000, styles_max: 500, title_max: 80,
  },
  policy: { version: 'music-prompt-v1', pre_debit: true },
});

test('longSongs is runtime-only and fails closed unless explicitly true', () => {
  assert.equal(musicRuntimeFlag('longSongs', {}), false);
  assert.equal(musicRuntimeFlag('longSongs', { MUSIC_LONG_SONGS_ENABLED: 'true' }), false);
  for (const value of [undefined, false, 'false', null, 0, 1, 'TRUE', {}, []]) {
    assert.equal(musicRuntimeFlag('longSongs', { MUSIC_RUNTIME_FLAGS: JSON.stringify({ longSongs: value }) }), false);
  }
  for (const value of [true, 'true']) {
    assert.equal(musicRuntimeFlag('longSongs', {
      MUSIC_RUNTIME_FLAGS: JSON.stringify({ longSongs: value }), MUSIC_LONG_SONGS_ENABLED: 'false',
    }), true);
  }
  for (const flags of ['{invalid', 'null', '[]']) {
    assert.equal(musicRuntimeFlag('longSongs', { MUSIC_RUNTIME_FLAGS: flags }), false);
  }
  const env = { MUSIC_RUNTIME_FLAGS: JSON.stringify({ longSongs: true, generation: true, beatAi: true, unknown: true }) };
  assert.equal(musicRuntimeFlag('generation', env), true);
  assert.equal(musicRuntimeFlag('generation', { ...env, MUSIC_GENERATION_ENABLED: 'false' }), false);
  assert.equal(musicRuntimeFlag('generation', { MUSIC_GENERATION_ENABLED: 'true' }), true);
  assert.equal(musicRuntimeFlag('beatAi', env), true);
  assert.equal(musicRuntimeFlag('unknown', env), false);
});

test('flag off rejects long durations for every model and both Custom variants', () => {
  for (const body of [...modelIds.map(simple), custom, customInstrumental]) {
    for (const options of [undefined, {}, { longSongs: false }]) {
      assert.deepEqual(parseMusicQuote({ ...body, duration_seconds: 61 }, options), { ok: false, error: 'duration_invalid' });
      assert.equal(parseMusicQuote(body, options).durationSeconds, 60);
      for (const seconds of [10, 60]) {
        assert.equal(parseMusicQuote({ ...body, duration_seconds: seconds }, options).ok, true);
      }
    }
  }
});

for (const paid of [false, true]) {
  test(`flag off preserves the entire ${paid ? 'paid' : 'unpaid'} entitlement response`, () => {
    const expected = previousEntitlements(paid);
    for (const options of [{}, { longSongs: false }]) {
      const actual = musicEntitlementProjection({ ...fixture(paid), ...options });
      assert.deepEqual(actual, expected);
      assert.equal(JSON.stringify(actual), JSON.stringify(expected));
    }
  });

  test(`flag on changes only premium duration controls for ${paid ? 'paid' : 'unpaid'} entitlements`, () => {
    const expected = previousEntitlements(paid);
    expected.models[1].controls.duration_seconds.max = 135;
    expected.models[1].controls.duration_price_block_seconds = 60;
    assert.deepEqual(musicEntitlementProjection({ ...fixture(paid), longSongs: true }), expected);
  });
}

test('flag on accepts integer 10..135 seconds for premium Simple and Custom only', () => {
  const options = { longSongs: true };
  for (const body of [simple('ace-step-1.5'), custom, customInstrumental]) {
    assert.equal(parseMusicQuote(body, options).durationSeconds, 60);
    for (const seconds of [10, 60, 61, 120, 121, 135]) {
      const result = parseMusicQuote({ ...body, duration_seconds: seconds }, options);
      assert.equal(result.ok, true);
      assert.equal(result.durationSeconds, seconds);
    }
    for (const seconds of [9, 136, 140, 180, 181, 120.5, '120']) {
      assert.deepEqual(parseMusicQuote({ ...body, duration_seconds: seconds }, options), { ok: false, error: 'duration_invalid' });
    }
  }
  for (const modelId of ['ace-step', 'ace-step-loop']) {
    for (const seconds of [61, 120, 121, 135, 136, 140, 180]) {
      assert.deepEqual(parseMusicQuote({ ...simple(modelId), duration_seconds: seconds }, options), { ok: false, error: 'duration_invalid' });
    }
    assert.equal(parseMusicQuote({ ...simple(modelId), duration_seconds: 60 }, options).ok, true);
  }
});

test('duration bounds widen only for premium with a boolean enabled flag', () => {
  assert.equal(MUSIC_LONG_SONG_MAX, 135);
  for (const modelId of [...modelIds, 'unknown']) {
    assert.deepEqual(musicDurationBounds(modelId), { min: 10, max: 60, default: 60 });
    for (const longSongs of [false, 'false', 'true', true]) {
      assert.deepEqual(musicDurationBounds(modelId, { longSongs }), {
        min: 10, max: modelId === 'ace-step-1.5' && longSongs === true ? 135 : 60, default: 60,
      });
    }
  }
});

test('display price blocks mirror SQL at each minute boundary and never scale other models', () => {
  for (const [seconds, blocks] of [[10, 1], [60, 1], [61, 2], [120, 2], [121, 3], [135, 3]]) {
    assert.equal(musicDurationPriceBlocks('ace-step-1.5', seconds), blocks);
    for (const modelId of ['ace-step', 'ace-step-loop', 'unknown']) {
      assert.equal(musicDurationPriceBlocks(modelId, seconds), 1);
    }
  }
});

test('both routes wire the runtime flag and quotes preserve database prices', async () => {
  const quote = await readFile(new URL('../app/api/v1/music/generation-quotes/route.js', import.meta.url), 'utf8');
  const entitlements = await readFile(new URL('../app/api/v1/music/entitlements/route.js', import.meta.url), 'utf8');
  for (const route of [quote, entitlements]) {
    assert.match(route, /import \{ [^}]*musicRuntimeFlag[^}]* \} from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/lib\/musicRuntime\.js';/);
  }
  assert.match(quote, /parseMusicQuote\(decoded\.value, \{ longSongs: musicRuntimeFlag\('longSongs'\) \}\)/);
  assert.match(entitlements, /musicEntitlementProjection\(\{[^}]*longSongs: musicRuntimeFlag\('longSongs'\)/);
  assert.match(quote, /credits_per_candidate: result\.unit_credits,/);
  assert.match(quote, /total_credits: result\.charged_credits \?\? result\.total_credits,/);
  assert.doesNotMatch(quote, /musicDurationPriceBlocks/);
});
