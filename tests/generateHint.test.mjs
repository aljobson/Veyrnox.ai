import test from 'node:test';
import assert from 'node:assert/strict';
import { generateHintKey, HINT_CODES } from '../app/veyrnox/_lib/generateHint.js';
import { readFileSync } from 'node:fs';

const ok = { ready: true, gated: false, sending: false, hasJobs: false, promptTooLong: false, needsReattach: false, overLimit: false,
  missingSource: false, animationMismatch: false, missingConsent: false, missingPrompt: false, missingVoice: false, invalidAudioDuration: false };
const key = flags => generateHintKey({ ...ok, ...flags });

test('nothing blocks: no hint', () => assert.equal(key({}), null));

test('each fixable condition gets its own hint', () => {
  assert.equal(key({ needsReattach: true }), 'reattach');
  assert.equal(key({ overLimit: true }), 'too_many');
  assert.equal(key({ missingSource: true }), 'source');
  assert.equal(key({ animationMismatch: true }), 'source');
  assert.equal(key({ missingConsent: true }), 'consent');
  assert.equal(key({ missingPrompt: true }), 'prompt');
  assert.equal(key({ missingVoice: true }), 'voice');
  assert.equal(key({ invalidAudioDuration: true }), 'duration');
});

test('with several problems the first one onSubmit would report wins', () => {
  assert.equal(key({ needsReattach: true, overLimit: true, missingSource: true, missingConsent: true, missingPrompt: true, missingVoice: true, invalidAudioDuration: true }), 'reattach');
  assert.equal(key({ missingConsent: true, missingPrompt: true, missingVoice: true }), 'consent');
  assert.equal(key({ missingPrompt: true, missingVoice: true, invalidAudioDuration: true }), 'prompt');
  assert.equal(key({ missingVoice: true, invalidAudioDuration: true }), 'voice');
});

test('an over-long prompt suppresses every hint, including later ones', () => {
  for (const flags of [{ missingVoice: true }, { invalidAudioDuration: true }, { missingConsent: true }, { missingPrompt: true }, { missingSource: true }]) {
    assert.equal(key({ promptTooLong: true, ...flags }), null, JSON.stringify(flags));
  }
});

test('no hint while the catalog or balance is loading, for a gated model, while sending, or after a result', () => {
  for (const flags of [{ ready: false }, { gated: true }, { sending: true }, { hasJobs: true }]) {
    assert.equal(key({ missingSource: true, missingConsent: true, ...flags }), null, JSON.stringify(flags));
  }
});

test('every hint that reuses banner copy has real copy, not the generic unknown message', () => {
  const source = readFileSync(new URL('../app/veyrnox/_lib/createErrors.js', import.meta.url), 'utf8');
  const copy = code => new RegExp(`['"]?${code.replace(':', ':')}['"]?\\s*:\\s*['"]([^'"]{20,})['"]`).exec(source)?.[1];
  const generic = copy('unknown');
  assert.ok(generic, 'the generic unknown copy exists');
  for (const [hint, code] of Object.entries(HINT_CODES)) {
    assert.ok(copy(code), `${hint} -> ${code} has copy`);
    assert.notEqual(copy(code), generic);
  }
  assert.deepEqual(Object.keys(HINT_CODES).sort(), ['consent', 'prompt', 'source', 'too_many', 'voice']);
});
