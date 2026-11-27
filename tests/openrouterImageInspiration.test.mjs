import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeImageInspiration, IMAGE_INSPIRATION_URL, ImageInspirationProviderError,
} from '../packages/adapters/openrouterImageInspiration.js';

const ok = value => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});

test('adapter sends verified image bytes as a fixed data URL with strict privacy routing', async () => {
  const bytes = Uint8Array.from([0, 1, 2, 253, 254, 255]); let call;
  const result = await analyzeImageInspiration({ apiKey: 'test', model: 'google/gemini-test', bytes, mediaType: 'image/jpeg',
    fetchImpl: async (url, init) => { call = { url, init }; return ok({ safe: true, brief: 'Amber geometric pulse', tags: ['amber'] }); } });
  assert.deepEqual(result, { ok: true, safe: true, brief: 'Amber geometric pulse', tags: ['amber'] });
  assert.equal(call.url, IMAGE_INSPIRATION_URL); assert.equal(call.init.redirect, 'manual');
  const body = JSON.parse(call.init.body);
  assert.deepEqual(body.provider, { data_collection: 'deny', zdr: true, require_parameters: true });
  assert.equal(body.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,AAEC/f7/');
  assert.match(body.messages[0].content[0].text, /Do not identify people or artists/);
});

test('image adapter refuses invalid media and maps provider failures without vendor detail', async () => {
  await assert.rejects(analyzeImageInspiration({ apiKey: 'test', model: 'google/gemini-test', bytes: Uint8Array.of(1), mediaType: 'image/gif' }),
    error => error instanceof ImageInspirationProviderError && error.code === 'provider_request_invalid');
  await assert.rejects(analyzeImageInspiration({ apiKey: 'test', model: 'google/gemini-test', bytes: Uint8Array.of(1), mediaType: 'image/png',
    fetchImpl: async () => new Response('secret vendor detail', { status: 422 }) }),
  error => error instanceof ImageInspirationProviderError && error.code === 'provider_request_rejected' && !error.message.includes('secret'));
  await assert.rejects(analyzeImageInspiration({ apiKey: 'test', model: 'google/gemini-test', bytes: Uint8Array.of(1), mediaType: 'image/webp',
    fetchImpl: async () => ok({ safe: true, brief: '', tags: [] }) }), { code: 'provider_response_invalid' });
});
