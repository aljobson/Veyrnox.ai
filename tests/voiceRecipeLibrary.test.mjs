import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('My Voice Recipes reads only the active account shelf and applies settings without side effects', () => {
  const component = read('../app/veyrnox/_components/VoiceRecipeLibrary.js');
  assert.match(component, /useSyncExternalStore\(onSessionChange, currentAccount, serverAccount\)/);
  assert.match(component, /readAudioVoiceRecipes\(window\.localStorage, accountId\)/);
  assert.match(component, /onApply\(item\.voiceRecipe, item\.name\)/);
  assert.match(component, /toggleSignatureVoiceRecipe\(window\.localStorage, accountId, item\.id\)/);
  assert.match(component, /Signature Voice Set/);
  assert.match(component, /Pin signature/);
  assert.match(component, /Set full/);
  assert.match(component, /title = 'My Voice Recipes'/);
  assert.match(component, /Applying a recipe changes settings only/);
  assert.match(component, /never restores a script, plays audio, generates media or spends credits/);
  assert.match(component, /not voice samples, scripts, embeddings or cloned identities/);
});

test('Text to Speech exposes the personal recipe library and keeps a visible review notice', () => {
  const page = read('../app/veyrnox/app/text-to-speech/TextToSpeechStudioClient.js');
  assert.match(page, /<VoiceRecipeLibrary onApply=/);
  assert.match(page, /setSettings\(recipe\); setReusedRecipe\(\{ name, settings: recipe \}\)/);
  assert.match(page, /Voice Recipe loaded:/);
  assert.match(page, /Voice Recipe modified:/);
  assert.match(page, /voiceRecipesMatch\(settings, reusedRecipe\.settings\)/);
  assert.match(page, /Restore recipe/);
  assert.match(page, /review every setting and approve the current price/);
  assert.match(page, /purpose="character-performance" voiceRecipe=\{item\.voice_recipe\} offerSignature/);
});
