import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../packages/db/schema/supabase/0609_retire_failed_media_models_and_stage_suno_sounds.sql', import.meta.url), 'utf8');
const activation = await readFile(new URL('../packages/db/schema/supabase/0610_activate_crun_suno_sounds.sql', import.meta.url), 'utf8');

test('the failed production offers retire without changing the working Qwen or ACE-Step rows', () => {
  for (const id of [
    'elevenlabs-sfx-v2', 'mmaudio-v2', 'mmaudio-v2-video', 'elevenlabs-tts-turbo', 'minimax-speech-2.6-hd',
    'inworld-tts', 'elevenlabs-dialogue', 'zonos2-voice-clone', 'demucs-stems',
    'latentsync', 'kling-o1-reference',
  ]) assert.match(migration, new RegExp(`'${id.replaceAll('.', '\\.')}'`), id);
  assert.doesNotMatch(migration, /UPDATE public\.model_catalog[\s\S]{0,500}'qwen3-tts'/);
  assert.doesNotMatch(migration, /UPDATE public\.model_catalog[\s\S]{0,500}'ace-step'/);
});

test('the honest CRUN sound-effects replacement is staged at the documented endpoint and two-credit floor', () => {
  assert.match(migration, /'suno-sounds', 'Suno Sound Effects', 'crun', 'crun:suno\/sounds-generate'/);
  assert.match(migration, /'text-to-audio', 2, 0\.0122, 'per_generation', NULL, false, false/);
  assert.match(migration, /1, 'standby', 'licensed_reseller'/);
  assert.doesNotMatch(migration, /'suno-sounds'[\s\S]{0,180}'active'/);
});

test('the paid CRUN proof activates only the exact staged sound-effects route and offer', () => {
  assert.match(activation, /CRUN log 725\*\*\*97f reported Success, 2\.5 credits consumed and 20 s provider duration/);
  assert.match(activation, /MP3 was playable and 1\.923606 s \/ 47,717 bytes/);
  assert.match(activation, /1febeb47ecfce6a1368e5b4e125c35ce19c323db19a8c91ab891d9a8a51da7e6/);
  assert.match(activation, /SET parity_record = '[^']+',\s*state = 'active'/);
  assert.match(activation, /WHERE model_id = 'suno-sounds' AND supplier = 'crun'[\s\S]*endpoint = 'crun:suno\/sounds-generate'/);
  assert.match(activation, /UPDATE public\.model_catalog\s+SET active = true/);
  assert.match(activation, /IF affected <> 1 THEN/);
  assert.doesNotMatch(activation, /qwen3-tts|ace-step|elevenlabs|mmaudio|latentsync|kling-o1-reference/);
});
