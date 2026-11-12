import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MAX_MUSIC_SAVED_MIXES,
  isMusicSavedMixId,
  normalizeMusicSavedMix,
  readMusicSavedMixes,
  saveMusicSavedMix,
} from '../app/veyrnox/_lib/music/savedMixes.js';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('saved music mixes are validated, account scoped and update in place', () => {
  const store = storage();
  const first = saveMusicSavedMix(store, 'account-a', {
    name: ' Night drive ', beatId: 'neon-rain',
    mix: { tempo: 0.8, drums: 85, bass: 70, melody: 25 },
  }, 1000);
  assert.ok(isMusicSavedMixId(first.id));
  assert.deepEqual(readMusicSavedMixes(store, 'account-b'), []);
  assert.deepEqual(readMusicSavedMixes(store, 'account-a'), [first]);

  const updated = saveMusicSavedMix(store, 'account-a', {
    ...first, name: 'Night drive v2', mix: { tempo: 4, drums: -10, bass: 63.7, melody: 45 },
  }, 2000);
  assert.equal(updated.id, first.id);
  assert.equal(updated.createdAt, 1000);
  assert.equal(updated.updatedAt, 2000);
  assert.deepEqual(updated.mix, { tempo: 1.25, drums: 0, bass: 64, melody: 45 });
  assert.deepEqual(readMusicSavedMixes(store, 'account-a'), [updated]);
});

test('saved music mixes reject unknown beats and malformed records', () => {
  const store = storage();
  assert.equal(saveMusicSavedMix(store, 'account-a', { name: 'Nope', beatId: 'not-a-beat' }, 1000), null);
  assert.equal(normalizeMusicSavedMix({ id: 'mix-bad', name: 'Nope', beatId: 'neon-rain', createdAt: 1, updatedAt: 1 }), null);
  assert.equal(readMusicSavedMixes({ getItem: () => '{broken' }, 'account-a').length, 0);
  assert.equal(MAX_MUSIC_SAVED_MIXES, 100);
});

test('Discover and both Library modes expose save, edit, listen and reuse paths', async () => {
  const [discover, page, saved, serverLibrary, localLibrary] = await Promise.all([
    readFile(new URL('../app/veyrnox/_components/music/MusicDiscover.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/veyrnox/app/music/discover/page.js', import.meta.url), 'utf8'),
    readFile(new URL('../app/veyrnox/_components/music/SavedMusicMixes.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/veyrnox/_components/music/MusicServerLibrary.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/veyrnox/_components/music/MusicLibrary.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(discover, /Save to Music Library/);
  assert.match(discover, /Update saved mix/);
  assert.match(discover, /saveMusicSavedMix/);
  assert.match(page, /initialSavedMixId/);
  assert.match(saved, /Edit &amp; listen/);
  assert.match(saved, /Use in Create/);
  assert.match(saved, /Saved in this browser for the current account/);
  assert.match(saved, /h-16 w-16/);
  assert.match(saved, /sizes="80px"/);
  assert.match(serverLibrary, /Saved mixes/);
  assert.match(localLibrary, /Saved mixes/);
});
