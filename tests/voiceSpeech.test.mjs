import test from 'node:test';
import assert from 'node:assert/strict';
import { validVoiceSpeechBody, voiceSpeechEnabled } from '../lib/voiceSpeech.js';

test('voice speech accepts one bounded script and a replay-safe key', () => {
  assert.deepEqual(validVoiceSpeechBody({ text: '  Hello  ', idempotency_key: 'voice:12345678' }), {
    text: 'Hello', idempotencyKey: 'voice:12345678',
  });
  assert.equal(validVoiceSpeechBody({ text: '', idempotency_key: 'voice:12345678' }), null);
  assert.equal(validVoiceSpeechBody({ text: 'x'.repeat(1001), idempotency_key: 'voice:12345678' }), null);
  assert.equal(validVoiceSpeechBody({ text: 'hello', idempotency_key: 'short' }), null);
});

test('voice speech requires explicit production activation', () => {
  assert.equal(voiceSpeechEnabled({ VERIFIED_VOICE_TTS_ENABLED: 'true' }), true);
  assert.equal(voiceSpeechEnabled({ VERIFIED_VOICE_TTS_ENABLED: 'TRUE' }), false);
  assert.equal(voiceSpeechEnabled({}), false);
});
