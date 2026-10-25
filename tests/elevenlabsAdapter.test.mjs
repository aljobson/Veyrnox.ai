import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addPvcSample, createPvc, deleteVoice, getPvcCaptcha, getVoice, isConfigured,
  synthesizeSpeech, trainPvc, verifyPvcCaptcha,
} from '../packages/adapters/elevenlabs.js';

const cfg = { apiKey: 'secret-test-key' };
const response = (body, init = {}) => new Response(
  body instanceof Uint8Array ? body : JSON.stringify(body),
  { status: init.status || 200, headers: { 'content-type': init.contentType || 'application/json', ...(init.headers || {}) } },
);
const recorder = (reply) => {
  const calls = [];
  return { calls, fetchCall: async (url, init, timeout, maxBytes) => {
    calls.push({ url: String(url), init, timeout, maxBytes });
    return typeof reply === 'function' ? reply(url, init) : reply;
  } };
};

test('configuration requires a server key', () => {
  assert.equal(isConfigured(cfg), true);
  assert.equal(isConfigured({}), false);
});

test('creates a PVC with bounded metadata and never places the key in the URL', async () => {
  const seen = recorder(response({ voice_id: 'voice_123' }));
  assert.deepEqual(await createPvc({ name: ' My voice ', language: 'en', description: 'Owner verified' }, cfg, seen), { ok: true, voiceId: 'voice_123' });
  assert.equal(seen.calls[0].url, 'https://api.elevenlabs.io/v1/voices/pvc');
  assert.equal(seen.calls[0].init.headers['xi-api-key'], cfg.apiKey);
  assert.deepEqual(JSON.parse(seen.calls[0].init.body), { name: 'My voice', language: 'en', description: 'Owner verified' });
  assert.equal(await createPvc({ name: '', language: 'en' }, cfg, seen).then(r => r.code), 'name_invalid');
});

test('uploads exactly one bounded mp3 sample as multipart', async () => {
  const seen = recorder(response([{ sample_id: 'sample-1', duration_secs: 61.5 }]));
  const result = await addPvcSample({ voiceId: 'voice_123', bytes: new Uint8Array([1, 2, 3]), contentType: 'audio/mpeg', filename: '../../mine.mp3' }, cfg, seen);
  assert.deepEqual(result, { ok: true, sample: { id: 'sample-1', durationSeconds: 61.5 } });
  assert.equal(seen.calls[0].url, 'https://api.elevenlabs.io/v1/voices/pvc/voice_123/samples');
  assert.ok(seen.calls[0].init.body instanceof FormData);
  assert.equal(seen.calls[0].init.body.get('files').name, '.._.._mine.mp3');
  assert.equal(seen.calls[0].init.headers['content-type'], undefined, 'runtime supplies the multipart boundary');
});

test('proxies captcha bytes, verifies a fresh recording, and starts training', async () => {
  const captcha = recorder(response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { contentType: 'image/png' }));
  const got = await getPvcCaptcha('voice_123', cfg, captcha);
  assert.equal(got.ok, true);
  assert.equal(got.contentType, 'image/png');
  assert.deepEqual([...got.bytes], [137, 80, 78, 71, 13, 10, 26, 10]);

  const verify = recorder(response({ status: 'ok' }));
  assert.deepEqual(await verifyPvcCaptcha({ voiceId: 'voice_123', bytes: new Uint8Array([1]), contentType: 'audio/wav' }, cfg, verify), { ok: true });
  assert.ok(verify.calls[0].init.body instanceof FormData);

  const train = recorder(response({ status: 'ok' }));
  assert.equal((await trainPvc('voice_123', cfg, train)).ok, true);
  assert.deepEqual(JSON.parse(train.calls[0].init.body), { model_id: 'eleven_multilingual_v2' });
});

test('decodes a JSON base64 captcha but rejects non-image provider bodies', async () => {
  const encoded = Buffer.from(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])).toString('base64');
  const got = await getPvcCaptcha('voice_123', cfg, recorder(response(encoded)));
  assert.equal(got.ok, true);
  assert.equal(got.contentType, 'image/png');
  assert.deepEqual([...got.bytes], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal((await getPvcCaptcha('voice_123', cfg, recorder(response({})))).code, 'provider_response_invalid');
  assert.equal((await trainPvc('voice_123', cfg, recorder(response({ status: 'queued' })))).code, 'provider_response_invalid');
});

test('reads only an owned, verified, fine-tuned voice as ready evidence', async () => {
  const seen = recorder(response({ voice_id: 'voice_123', is_owner: true, voice_verification: { is_verified: true, requires_verification: true }, fine_tuning: { state: { eleven_multilingual_v2: 'fine_tuned' } } }));
  assert.deepEqual((await getVoice('voice_123', cfg, seen)).voice, {
    id: 'voice_123', owned: true, verified: true, requiresVerification: true, state: 'fine_tuned',
  });
});

test('deletes a voice and classifies upstream failures without returning provider bodies', async () => {
  assert.deepEqual(await deleteVoice('voice_123', cfg, recorder(response({ status: 'ok' }))), { ok: true });
  assert.deepEqual(await deleteVoice('voice_123', cfg, recorder(response({}, { status: 404 }))), { ok: true, replayed: true });
  const failed = await createPvc({ name: 'Mine', language: 'en' }, cfg, recorder(response({ detail: 'sensitive upstream text' }, { status: 429, headers: { 'retry-after': '12' } })));
  assert.deepEqual(failed, { ok: false, status: 429, code: 'provider_rate_limited', retryAfter: 12 });
  assert.equal(JSON.stringify(failed).includes('sensitive'), false);
});

test('renders bounded speech with the private PVC id and pinned output contract', async () => {
  const seen = recorder(response(new Uint8Array([0x49, 0x44, 0x33, 1]), { contentType: 'audio/mpeg' }));
  const result = await synthesizeSpeech({ voiceId: 'voice_123', text: '  Hello from my voice.  ' }, cfg, seen);
  assert.equal(result.ok, true);
  assert.deepEqual([...result.bytes], [0x49, 0x44, 0x33, 1]);
  assert.equal(seen.calls[0].url, 'https://api.elevenlabs.io/v1/text-to-speech/voice_123?output_format=mp3_44100_128');
  assert.deepEqual(JSON.parse(seen.calls[0].init.body), { text: 'Hello from my voice.', model_id: 'eleven_multilingual_v2' });
  assert.equal(seen.calls[0].maxBytes, 20 * 1024 * 1024);
  assert.equal((await synthesizeSpeech({ voiceId: 'voice_123', text: '' }, cfg, seen)).code, 'speech_text_invalid');
  assert.equal((await synthesizeSpeech({ voiceId: 'voice_123', text: 'x'.repeat(1001) }, cfg, seen)).code, 'speech_text_invalid');
  assert.equal((await synthesizeSpeech({ voiceId: 'voice_123', text: 'hello' }, cfg,
    recorder(response({}, { contentType: 'application/json' })))).code, 'provider_response_invalid');
});
