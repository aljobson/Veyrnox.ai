import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TTS_VOICES, voiceGenderOptions } from '../app/veyrnox/_lib/textToSpeech.js';
import { LOCALES } from '../lib/i18n/locales.mjs';

test('every stock voice has a gender, and names that say one agree with it', () => {
  for (const voice of TTS_VOICES) {
    assert.ok(['female', 'male', 'neutral'].includes(voice.gender), voice.id);
    const words = voice.id.toLowerCase().split('_');
    if (words.some((word) => ['woman', 'girl', 'abbess'].includes(word))) assert.equal(voice.gender, 'female', voice.id);
    if (words.some((word) => ['man', 'guy', 'boy', 'knight'].includes(word))) assert.equal(voice.gender, 'male', voice.id);
  }
});

test('the two names that do not say a gender follow MiniMax\'s English voices of the same name', () => {
  const byId = Object.fromEntries(TTS_VOICES.map((voice) => [voice.id, voice]));
  assert.equal(byId.Friendly_Person.gender, 'male');
  assert.equal(byId.Imposing_Manner.gender, 'female');
});

test('the gender filter offers only genders some voice has, in a fixed order', () => {
  assert.deepEqual(voiceGenderOptions(), ['female', 'male']);
  assert.deepEqual(voiceGenderOptions([{ gender: 'neutral' }, { gender: 'male' }]), ['male', 'neutral']);
  assert.deepEqual(voiceGenderOptions([]), []);
});

test('the picker shows gender beside the tone, names the card with it, and never truncates a name', () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/TextToSpeechControls.js', import.meta.url), 'utf8');
  assert.match(source, /\{genderLabel\(selectedVoice\)\} · \{selectedVoice\.tone\}/);
  assert.match(source, /\{genderLabel\(voice\)\} · \{voice\.tone\}/);
  assert.match(source, /aria-label=\{t\('app\.audio\.voice\.card'/);
  assert.match(source, /voiceGenderOptions\(\)\.map/);
  assert.doesNotMatch(source, /truncate[^"]*">\{(selectedVoice|voice)\.label\}/);
});

test('every language has the gender and card strings', async () => {
  for (const { code } of LOCALES) {
    const { default: messages } = await import(`../lib/i18n/messages/app/${code}/audio-hub.mjs`);
    for (const key of ['app.audio.voice.gender.female', 'app.audio.voice.gender.male', 'app.audio.voice.gender.neutral']) {
      assert.ok(messages[key], `${code} ${key}`);
    }
    for (const slot of ['{name}', '{gender}', '{tone}']) assert.ok(messages['app.audio.voice.card'].includes(slot), `${code} card ${slot}`);
  }
});
