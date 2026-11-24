import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeAudioInspiration, AUDIO_INSPIRATION_URL, AudioInspirationProviderError,
} from '../packages/adapters/openrouterAudioInspiration.js';

const ok = value => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});

test('adapter sends exact audio bytes to fixed URL with no-data-collection routing', async () => {
  const bytes = Uint8Array.from([0, 1, 2, 253, 254, 255]);
  let call;
  const result = await analyzeAudioInspiration({ apiKey: 'test', model: 'openai/gpt-audio', bytes, format: 'mp3',
    fetchImpl: async (url, init) => { call = { url, init }; return ok({ safe: true, brief: 'Bright pulse', tags: ['bright'] }); } });
  assert.deepEqual(result, { ok: true, safe: true, brief: 'Bright pulse', tags: ['bright'] });
  assert.equal(call.url, AUDIO_INSPIRATION_URL);
  assert.equal(call.init.redirect, 'manual');
  const body = JSON.parse(call.init.body);
  assert.deepEqual(body.provider, { data_collection: 'deny' });
  assert.equal(body.messages[0].content[1].input_audio.data, 'AAEC/f7/');
  assert.equal(body.messages[0].content[1].input_audio.format, 'mp3');
});

test('adapter refuses vendor bodies, malformed JSON and oversized responses with typed public codes', async () => {
  const run = fetchImpl => analyzeAudioInspiration({ apiKey: 'test', model: 'openai/gpt-audio', bytes: Uint8Array.of(1), format: 'wav', fetchImpl });
  await assert.rejects(run(async () => new Response('secret vendor detail', { status: 429 })),
    error => error instanceof AudioInspirationProviderError && error.code === 'provider_rate_limited' && !error.message.includes('secret'));
  await assert.rejects(run(async () => ok({ safe: true, brief: '', tags: [] })), { code: 'provider_response_invalid' });
  await assert.rejects(run(async () => new Response('x'.repeat(33 * 1024), { status: 200 })), { code: 'provider_response_invalid' });
  await assert.rejects(run(async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.test' } })),
    { code: 'provider_unavailable' });
});
