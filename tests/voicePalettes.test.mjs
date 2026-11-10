import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BUILTIN_VOICE_PALETTES,
  VOICE_PALETTE_CATEGORIES,
  consumeVoiceRecipeHandoff,
  normalizeVoicePaletteSettings,
  readVoicePalettes,
  removeVoicePalette,
  saveVoicePalette,
  stageVoiceRecipeHandoff,
  voiceRecipeSummary,
  voiceRecipesMatch,
} from '../app/veyrnox/_lib/voicePalettes.js';
import { DEFAULT_TTS_SETTINGS } from '../app/veyrnox/_lib/textToSpeech.js';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('Veyrnox voice palettes use supported stock voices and delivery settings', () => {
  assert.equal(BUILTIN_VOICE_PALETTES.length, 20);
  assert.deepEqual(BUILTIN_VOICE_PALETTES.slice(0, 2).map((palette) => palette.name), ['Quiet confidence', 'Story depth']);
  assert.equal(new Set(BUILTIN_VOICE_PALETTES.map((palette) => palette.id)).size, 20);
  assert.equal(new Set(BUILTIN_VOICE_PALETTES.map((palette) => palette.name)).size, 20);
  for (const palette of BUILTIN_VOICE_PALETTES) {
    assert.ok(VOICE_PALETTE_CATEGORIES.includes(palette.category), palette.id);
    assert.ok(palette.description.length > 10, palette.id);
  }
  for (const palette of BUILTIN_VOICE_PALETTES) {
    assert.deepEqual(normalizeVoicePaletteSettings(palette.settings), palette.settings);
  }
});

test('personal palettes persist settings without scripts, audio, or identity data', () => {
  const local = storage();
  assert.deepEqual(saveVoicePalette(local, 'Weekly update', DEFAULT_TTS_SETTINGS, 'personal-weekly'), [{
    id: 'personal-weekly',
    name: 'Weekly update',
    settings: DEFAULT_TTS_SETTINGS,
  }]);
  const revised = { ...DEFAULT_TTS_SETTINGS, emotion: 'happy', speed: 1.1 };
  assert.deepEqual(saveVoicePalette(local, 'weekly UPDATE', revised, 'personal-unused'), [{
    id: 'personal-weekly',
    name: 'weekly UPDATE',
    settings: revised,
  }]);
  assert.deepEqual(removeVoicePalette(local, 'personal-weekly'), []);
});

test('Voice Recipe handoff is one-time, account-matched, and settings-only', () => {
  const session = storage();
  assert.equal(stageVoiceRecipeHandoff(session, 'account-a', 'Weekly update', {
    ...DEFAULT_TTS_SETTINGS,
    script: 'private script',
    bytes: 'audio bytes',
  }), true);
  assert.doesNotMatch(session.getItem('veyrnox.voice-recipe-handoff.v1'), /private script|audio bytes/);
  assert.deepEqual(consumeVoiceRecipeHandoff(session, 'account-a'), {
    label: 'Weekly update', settings: DEFAULT_TTS_SETTINGS,
  });
  assert.equal(consumeVoiceRecipeHandoff(session, 'account-a'), null);

  assert.equal(stageVoiceRecipeHandoff(session, 'account-a', 'Wrong owner', DEFAULT_TTS_SETTINGS), true);
  assert.equal(consumeVoiceRecipeHandoff(session, 'account-b'), null);
  assert.equal(stageVoiceRecipeHandoff(session, 'account-a', 'Clone', { ...DEFAULT_TTS_SETTINGS, voice: 'cloned-person' }), false);
  assert.equal(voiceRecipeSummary(DEFAULT_TTS_SETTINGS), 'Wise woman · neutral · 1×');
  assert.equal(voiceRecipesMatch(DEFAULT_TTS_SETTINGS, { ...DEFAULT_TTS_SETTINGS }), true);
  assert.equal(voiceRecipesMatch(DEFAULT_TTS_SETTINGS, { ...DEFAULT_TTS_SETTINGS, pitch: 1 }), false);
  assert.equal(voiceRecipesMatch(DEFAULT_TTS_SETTINGS, { ...DEFAULT_TTS_SETTINGS, voice: 'cloned-person' }), false);
});

test('personal palette storage rejects cloned voices and malformed delivery values', () => {
  const local = storage();
  assert.deepEqual(saveVoicePalette(local, 'Clone', { ...DEFAULT_TTS_SETTINGS, voice: 'cloned-user-voice' }, 'personal-clone'), []);
  assert.deepEqual(saveVoicePalette(local, 'Too fast', { ...DEFAULT_TTS_SETTINGS, speed: 2.1 }, 'personal-fast'), []);
  assert.deepEqual(readVoicePalettes({ getItem: () => '{bad' }), []);
});

test('the voice controls expose accessible apply, save, and delete palette actions', () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/TextToSpeechControls.js', import.meta.url), 'utf8');
  assert.match(source, /Voice Palettes/);
  assert.match(source, /Save current palette/);
  assert.match(source, /Delete \$\{palette\.name\} voice palette/);
  assert.match(source, /never your script, audio, or a cloned identity/);
});

test('a sample line also sets the speech language so the job matches the script', () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/TextToSpeechControls.js', import.meta.url), 'utf8');
  assert.match(source, /function applySampleLine[\s\S]*?patchSetting\('language', templateLanguage\);[\s\S]*?onScript\(text\)/);
});

test('Text to Speech saves and consumes the exact submitted Voice Recipe', () => {
  const page = readFileSync(new URL('../app/veyrnox/app/text-to-speech/TextToSpeechStudioClient.js', import.meta.url), 'utf8');
  assert.match(page, /voice_recipe: \{ \.\.\.settings, voice: voiceId \}/);
  assert.match(page, /voiceRecipe=\{item\.voice_recipe\}/);
  assert.match(page, /voiceRecipe=\{job\.voice_recipe\}/);
  assert.match(page, /consumeVoiceRecipeHandoff\(window\.sessionStorage/);
  assert.match(page, /No script or audio was carried here/);
  assert.match(page, /Voice Recipe modified:/);
  assert.match(page, /Restore recipe/);
});

test('voice template samples cover ten supported languages and every category within the script limit', async () => {
  const { VOICE_TEMPLATE_LANGUAGES, voiceTemplateSample } = await import('../app/veyrnox/_lib/voiceTemplateSamples.js');
  const { TTS_LANGUAGES, TTS_SCRIPT_LIMIT } = await import('../app/veyrnox/_lib/textToSpeech.js');
  assert.equal(VOICE_TEMPLATE_LANGUAGES.length, 10);
  for (const language of VOICE_TEMPLATE_LANGUAGES) {
    assert.ok(TTS_LANGUAGES.includes(language), language);
    for (const category of VOICE_PALETTE_CATEGORIES) {
      const text = voiceTemplateSample(language, category);
      assert.ok(text.length > 10 && text.length <= TTS_SCRIPT_LIMIT, `${language}/${category}`);
    }
  }
});
