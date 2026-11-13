import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { LICENSED_MUSIC_CATEGORIES, LICENSED_MUSIC_TRACKS, licensedArtworkUrl, licensedMusicUrl } from '../lib/licensedMusicCatalog.js';

test('licensed music exposes exactly 87 recordings across broad listening categories', () => {
  assert.equal(LICENSED_MUSIC_TRACKS.length, 87);
  assert.deepEqual(LICENSED_MUSIC_CATEGORIES, [
    'All',
    'Cinematic adventure',
    'Piano & reflective',
    'Dark & suspense',
    'Action & hybrid',
    'Ambient & atmospheric',
    'Uplifting',
    'Whimsical',
    'Epic orchestral',
    'Jazz & acoustic',
    'Hip-hop',
    'Rock',
    'Jazz',
    'Electronic',
    'Funk',
    'Ambient',
    'Classical',
    'Acoustic',
    'Soul',
    'Indie',
    'Blues',
    'Reggae',
  ]);
  assert.equal(new Set(LICENSED_MUSIC_TRACKS.map((track) => track.id)).size, 87);
  for (const category of LICENSED_MUSIC_CATEGORIES.slice(-12)) {
    assert.equal(LICENSED_MUSIC_TRACKS.filter((track) => track.category === category).length, 3, category);
  }
});

test('every licensed track has an immutable local audio file, artwork and CC BY receipt', () => {
  for (const track of LICENSED_MUSIC_TRACKS) {
    assert.match(track.id, /^[a-z0-9-]+$/);
    assert.match(track.file, /^[a-z0-9-]+\.mp3$/);
    assert.match(track.artwork, /^[a-z0-9-]+\.(?:jpg|svg)$/);
    assert.match(track.license, /^CC BY (?:2\.5|3\.0|4\.0)$/);
    assert.match(track.licenseUrl, /^https:\/\/creativecommons\.org\/licenses\/by\/(?:2\.5|3\.0|4\.0)\/$/);
    assert.match(track.sourceUrl, /^https:\/\/(?:soundcloud\.com|ccmixter\.org)\//);
    assert.match(track.downloadSourceUrl, /^https:\/\//);
    assert.ok(track.attribution.includes(track.creator));
    const audio = new URL(`../public/music-licensed/${track.file}`, import.meta.url);
    const artwork = new URL(`../public/music-licensed/${track.artwork}`, import.meta.url);
    const audioBytes = readFileSync(audio);
    const artworkBytes = readFileSync(artwork);
    assert.equal(audioBytes.byteLength, track.bytes);
    assert.ok(artworkBytes.byteLength > 0, `${track.artwork} is empty`);
    assert.equal(createHash('sha256').update(audioBytes).digest('hex'), track.sha256);
    assert.equal(licensedMusicUrl(track), `/music-licensed/${track.file}`);
    assert.equal(licensedArtworkUrl(track), `/music-licensed/${track.artwork}`);
  }
});

test('the ccMixter expansion uses official source records and original local artwork', () => {
  const tracks = LICENSED_MUSIC_TRACKS.filter((track) => track.sourceProvider === 'ccMixter');
  assert.equal(tracks.length, 36);
  for (const track of tracks) {
    assert.match(track.id, /^ccmixter-\d+-/);
    assert.match(track.sourceUrl, /^https:\/\/ccmixter\.org\/files\//);
    assert.match(track.downloadSourceUrl, /^https:\/\/ccmixter\.org\/content\//);
    assert.match(track.artwork, /^ccmixter-\d+-.+\.svg$/);
    assert.match(track.attribution, /available at ccMixter\.org/);
  }
});

test('Discover exposes playable licensed recordings without a generation handoff', () => {
  const discover = readFileSync(new URL('../app/veyrnox/_components/music/MusicDiscover.jsx', import.meta.url), 'utf8');
  const library = readFileSync(new URL('../app/veyrnox/_components/music/LicensedMusicLibrary.jsx', import.meta.url), 'utf8');
  assert.match(discover, /<LicensedMusicLibrary \/>/);
  assert.match(library, /<audio controls preload="none"/);
  assert.match(library, /musicDiscover\.lic\.download/);
  assert.match(library, /Math\.min\(PAGE_SIZE/);
  assert.match(library, /musicDiscover\.lic\.title/);
  assert.match(library, /h-16 w-16.*sm:h-20 sm:w-20/);
  assert.match(library, /sizes="80px"/);
  assert.doesNotMatch(library, /aspect-square/);
  assert.match(library, /musicDiscover\.lic\.source/);
  assert.match(library, /musicDiscover\.lic\.creatorDownload/);
  assert.doesNotMatch(library, /Sample this beat|\/app\/music\/create|generation.*href/i);
});
