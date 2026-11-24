import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const client = await readFile(new URL('../apps/mobile/src/lib/music/client.ts', import.meta.url), 'utf8');
const validate = await readFile(new URL('../apps/mobile/src/lib/music/validate.ts', import.meta.url), 'utf8');
const types = await readFile(new URL('../apps/mobile/src/lib/music/types.ts', import.meta.url), 'utf8');

test('iPhone entitlement contract fails inspiration closed without usable source kinds', () => {
  assert.match(client, /inspiration: projectedFeatures\.inspiration === true && safeSources\.length > 0/);
  assert.match(client, /inspiration_sources: inspirationEnabled \? safeSources : \[\]/);
  assert.match(validate, /new Set\(v\.inspiration_sources\)\.size === v\.inspiration_sources\.length/);
  assert.match(types, /readonly inspiration_sources: readonly \('audio' \| 'image' \| 'video_frames'\)\[\]/);
});
