import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { LICENSED_MUSIC_CATEGORIES, LICENSED_MUSIC_TRACKS, licensedArtworkUrl, licensedMusicUrl } from '../lib/licensedMusicCatalog.js';

test('licensed music spans six distinct listening categories', () => {
  assert.equal(LICENSED_MUSIC_TRACKS.length, 6);
  assert.equal(new Set(LICENSED_MUSIC_TRACKS.map((track) => track.category)).size, 6);
  assert.deepEqual(LICENSED_MUSIC_CATEGORIES, ['All', ...LICENSED_MUSIC_TRACKS.map((track) => track.category)]);
});

test('every licensed track has an immutable local audio file, artwork and CC BY receipt', () => {
  for (const track of LICENSED_MUSIC_TRACKS) {
    assert.match(track.id, /^[a-z0-9-]+$/);
    assert.match(track.file, /^[a-z0-9-]+\.mp3$/);
    assert.match(track.artwork, /^[a-z0-9-]+\.jpg$/);
    assert.equal(track.license, 'CC BY 4.0');
    assert.equal(track.licenseUrl, 'https://creativecommons.org/licenses/by/4.0/');
    assert.match(track.sourceUrl, /^https:\/\/soundcloud\.com\//);
    assert.match(track.downloadSourceUrl, /^https:\/\//);
    assert.ok(track.attribution.includes(track.creator));
    const audio = new URL(`../public/music-licensed/${track.file}`, import.meta.url);
    const artwork = new URL(`../public/music-licensed/${track.artwork}`, import.meta.url);
    assert.ok(existsSync(audio), `${track.file} missing`);
    assert.ok(existsSync(artwork), `${track.artwork} missing`);
    assert.equal(statSync(audio).size, track.bytes);
    assert.equal(createHash('sha256').update(readFileSync(audio)).digest('hex'), track.sha256);
    assert.equal(licensedMusicUrl(track), `/music-licensed/${track.file}`);
    assert.equal(licensedArtworkUrl(track), `/music-licensed/${track.artwork}`);
  }
});

test('Discover exposes playable licensed recordings without a generation handoff', () => {
  const discover = readFileSync(new URL('../app/veyrnox/_components/music/MusicDiscover.jsx', import.meta.url), 'utf8');
  const library = readFileSync(new URL('../app/veyrnox/_components/music/LicensedMusicLibrary.jsx', import.meta.url), 'utf8');
  assert.match(discover, /<LicensedMusicLibrary \/>/);
  assert.match(library, /<audio controls preload="none"/);
  assert.match(library, /Download MP3/);
  assert.match(library, /SoundCloud source/);
  assert.match(library, /Creator download/);
  assert.doesNotMatch(library, /Sample this beat|\/app\/music\/create|generation.*href/i);
});
