import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const client = await readFile(new URL('../apps/mobile/src/lib/music/client.ts', import.meta.url), 'utf8');
const validate = await readFile(new URL('../apps/mobile/src/lib/music/validate.ts', import.meta.url), 'utf8');
const types = await readFile(new URL('../apps/mobile/src/lib/music/types.ts', import.meta.url), 'utf8');
const consent = await readFile(new URL('../apps/mobile/src/lib/aiConsent.ts', import.meta.url), 'utf8');
const card = await readFile(new URL('../apps/mobile/src/components/music/MusicInspirationCard.tsx', import.meta.url), 'utf8');
const create = await readFile(new URL('../apps/mobile/src/app/(app)/music/create.tsx', import.meta.url), 'utf8');

test('iPhone entitlement contract fails inspiration closed without usable source kinds', () => {
  assert.match(client, /inspiration: projectedFeatures\.inspiration === true && safeSources\.length > 0/);
  assert.match(client, /inspiration_sources: inspirationEnabled \? safeSources : \[\]/);
  assert.match(validate, /new Set\(v\.inspiration_sources\)\.size === v\.inspiration_sources\.length/);
  assert.match(types, /readonly inspiration_sources: readonly \('audio' \| 'image' \| 'video_frames'\)\[\]/);
});

test('iPhone audio inspiration is consent-gated, size-bounded and review-before-apply', () => {
  assert.match(consent, /music\\\/inspiration/);
  assert.match(card, /MUSIC_INSPIRATION_MAX_BYTES = 8 \* 1024 \* 1024/);
  assert.match(card, /rights_confirmed|analyzeMusicInspiration/);
  assert.match(card, /onApply\(result\.brief\)/);
  assert.match(create, /inspiration_sources\.includes\('audio'\)/);
  assert.match(create, /<MusicInspirationCard api=\{api\}/);
});
