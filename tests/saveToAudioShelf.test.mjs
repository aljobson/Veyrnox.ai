import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Save to Audio Shelf revalidates owned audio before storing metadata', () => {
  const component = read('../app/veyrnox/_components/SaveToAudioShelfButton.js');
  assert.match(component, /useSyncExternalStore\(onSessionChange, currentAccount, serverAccount\)/);
  assert.match(component, /await fetchOwnedAudioReference\(gatewayFetch, jobId\)/);
  assert.match(component, /saveAudioReference\(window\.localStorage, accountId, \{ jobId, name, purpose, voiceRecipe \}\)/);
  assert.match(component, /veyrnox:auth-required/);
  assert.match(component, /Save to Audio Shelf/);
  assert.match(component, /Add Voice Recipe to Shelf/);
  assert.match(component, /toggleSignatureVoiceRecipe\(window\.localStorage, accountId, itemId\)/);
  assert.match(component, /Pin as signature/);
  assert.match(component, /Signature set full/);
  assert.match(component, /Unpin signature/);
});

test('Text to Speech exposes shelf saves only for completed audio results', () => {
  const page = read('../app/veyrnox/app/text-to-speech/TextToSpeechStudioClient.js');
  assert.match(page, /item\.state === 'succeeded' && item\.asset_url[\s\S]*?<SaveToAudioShelfButton[\s\S]*?purpose="character-performance"/);
  assert.match(page, /job\?\.state === 'succeeded' && job\?\.asset_url[\s\S]*?<SaveToAudioShelfButton[\s\S]*?purpose="narration-presenter"/);
  assert.match(page, /voiceRecipe=\{item\.voice_recipe\}/);
  assert.match(page, /voiceRecipe=\{job\.voice_recipe\}/);
  assert.match(page, /voiceRecipe=\{item\.voice_recipe\} offerSignature/);
  assert.match(page, /voiceRecipe=\{job\.voice_recipe\} offerSignature/);
  assert.match(page, /purpose="character-performance" queueSource="speech"/);
  assert.match(page, /purpose="narration-presenter" queueSource="speech"/);
  assert.match(page, /Use for lip sync/);
});

test('Dialogue saves completed audio for lip sync but never saves photo-dialogue video', () => {
  const page = read('../app/veyrnox/app/dialogue/DialogueStudioClient.js');
  assert.match(page, /job\?\.state === 'succeeded' && job\?\.asset_url/);
  assert.match(page, /modeId !== 'photo-dialogue' && <SaveToAudioShelfButton[\s\S]*?purpose="lip-sync-dialogue"/);
  assert.match(page, /purpose="lip-sync-dialogue" queueSource="dialogue"/);
  assert.match(page, /modeId !== 'photo-dialogue' && <Link href=\{`\/app\/performance\?audio=/);
});

test('Library exposes the same validated shelf action for every completed audio asset', () => {
  const card = read('../app/veyrnox/_components/LibraryJobCard.js');
  assert.match(card, /row\.state === 'succeeded' && row\.asset_url && row\.mime_type\?\.startsWith\('audio\/'\)/);
  assert.match(card, /<SaveToAudioShelfButton/);
  assert.match(card, /name=\{`Library · \$\{model\?\.name \|\| 'Owned audio'\}`\}/);
  assert.match(card, /row\.model_id === 'elevenlabs-dialogue'[\s\S]*?'lip-sync-dialogue'/);
  assert.match(card, /\['minimax-speech-2\.6-hd', 'qwen3-tts'\]\.includes\(row\.model_id\)\s*\? 'narration-presenter'/);
  assert.match(card, /: 'timing-rhythm'/);
  assert.match(card, /model\?\.modality\?\.includes\('music'\) \? 'music' : 'audio_shelf'/);
  assert.doesNotMatch(card, /name=\{`Library · \$\{row\.(?:prompt|name)/);
});
