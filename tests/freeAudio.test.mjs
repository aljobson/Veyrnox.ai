import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { FREE_AUDIO, freeAudioIn } from '../app/veyrnox/_lib/freeAudio.js';

test('free audio: 19 music and 20 sound effects, unique ids and files', () => {
  assert.equal(freeAudioIn('music').length, 19);
  assert.equal(freeAudioIn('sfx').length, 20);
  assert.equal(new Set(FREE_AUDIO.map((i) => i.id)).size, FREE_AUDIO.length);
  assert.equal(new Set(FREE_AUDIO.map((i) => i.file)).size, FREE_AUDIO.length);
});

test('every free audio entry has provenance and a file on disk', () => {
  for (const item of FREE_AUDIO) {
    assert.match(item.file, /^[a-z0-9-]+\.mp3$/, item.id);
    assert.ok(item.title && item.creator && item.license, item.id);
    assert.match(item.sourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/, item.id);
    const path = new URL(`../public/free-audio/${item.file}`, import.meta.url);
    assert.ok(existsSync(path), `${item.file} missing`);
    assert.equal(statSync(path).size, item.bytes, item.id);
  }
});
