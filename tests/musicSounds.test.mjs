import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { capabilityFor } from '../lib/modelCapabilities.js';

const pageUrl = new URL('../app/veyrnox/app/music/sounds/page.js', import.meta.url);
const catalogMigrationUrl = new URL('../packages/db/schema/supabase/0088_speech_sfx_and_background_removal.sql', import.meta.url);
const sfxActivationUrl = new URL('../packages/db/schema/supabase/0042_activate_elevenlabs_sfx_v2.sql', import.meta.url);

test('Music Sounds exposes the admitted looping model without inventing BPM or key controls', async () => {
  const page = await readFile(pageUrl, 'utf8');
  assert.match(page, /model=elevenlabs-sfx-v2/);
  assert.match(page, /model=mmaudio-v2/);
  assert.match(page, /Looping is available on ElevenLabs Sound Effects/);
  assert.match(page, /Seamless loop/);
  assert.match(page, /BPM and musical key are prompt directions/);
  assert.doesNotMatch(page, /bpm=|key=/i);
});

test('one-shot models pin exact bounded outputs and are active in the catalog history', async () => {
  const eleven = capabilityFor('fal-ai/elevenlabs/sound-effects/v2');
  const mmaudio = capabilityFor('fal-ai/mmaudio-v2/text-to-audio');
  assert.deepEqual(eleven.fixed, { duration_seconds: 10 });
  assert.deepEqual(eleven.inputs.loop, { type: 'bool' });
  assert.equal(mmaudio.inputs.loop, undefined);
  assert.deepEqual(mmaudio.fixed, { duration: 8, num_steps: 25 });
  assert.equal(eleven.inputs.prompt.required, true);
  assert.equal(mmaudio.inputs.prompt.required, true);
  const [catalog, activation] = await Promise.all([
    readFile(catalogMigrationUrl, 'utf8'), readFile(sfxActivationUrl, 'utf8'),
  ]);
  assert.match(catalog, /'mmaudio-v2'[\s\S]*'text-to-audio'[\s\S]*false, true/);
  assert.match(activation, /SET active = true/);
});
