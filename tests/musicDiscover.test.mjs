import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import {
  MUSIC_DISCOVER_BEATS,
  MUSIC_SAMPLE_DIRECTION_MAX,
  buildMusicSamplePrompt,
  getMusicDiscoverSeed,
} from '../lib/musicDiscover.js';

const discoverUrl = new URL('../app/veyrnox/_components/music/MusicDiscover.jsx', import.meta.url);
const createUrl = new URL('../app/veyrnox/_components/music/MusicServerStudio.jsx', import.meta.url);
const createPageUrl = new URL('../app/veyrnox/app/music/create/page.js', import.meta.url);
const navUrl = new URL('../app/veyrnox/_components/music/MusicPreviewShell.jsx', import.meta.url);

test('the discovery library exposes twelve unique original seed recipes with thumbnails', async () => {
  assert.equal(MUSIC_DISCOVER_BEATS.length, 12);
  assert.equal(new Set(MUSIC_DISCOVER_BEATS.map((beat) => beat.id)).size, MUSIC_DISCOVER_BEATS.length);
  assert.equal(new Set(MUSIC_DISCOVER_BEATS.map((beat) => beat.section)).size, 4);
  assert.ok(new Set(MUSIC_DISCOVER_BEATS.map((beat) => beat.mood)).size >= 10);
  for (const beat of MUSIC_DISCOVER_BEATS) {
    assert.match(beat.id, /^[a-z0-9-]+$/);
    assert.match(beat.artwork, /^\/music-discover\/[a-z0-9-]+\.(?:jpg|svg)$/);
    assert.ok(beat.recipe.length > 80 && beat.recipe.length < 260);
    assert.ok(beat.bpm >= 80 && beat.bpm <= 140);
    await access(new URL(`../public${beat.artwork}`, import.meta.url));
  }
});

test('sample handoff is allowlisted and always remains inside the 500-character quote boundary', () => {
  const seed = getMusicDiscoverSeed('neon-rain');
  assert.equal(seed.title, 'Neon Rain');
  assert.equal(getMusicDiscoverSeed('unknown-seed'), null);
  assert.equal(getMusicDiscoverSeed(['neon-rain']), null);
  assert.equal(buildMusicSamplePrompt({ id: 'unknown-seed' }, 'copy anything'), '');
  const prompt = buildMusicSamplePrompt({ id: seed.id }, 'x'.repeat(MUSIC_SAMPLE_DIRECTION_MAX + 40));
  assert.ok(prompt.length <= 500);
  assert.match(prompt, /New direction: x{200}$/);
  assert.match(buildMusicSamplePrompt(seed), /fresh instrumental variation/);
});

test('discover provides playable cards, filters, cover art and a transparent recipe handoff', async () => {
  const source = await readFile(discoverUrl, 'utf8');
  assert.match(source, /musicDiscover\.sample/);
  assert.match(source, /schedulePreview/);
  assert.match(source, /musicDiscover\.searchPlaceholder/);
  assert.match(source, /musicDiscover\.note/);
  assert.match(source, /<Image src=\{beat\.artwork\}/);
  assert.match(source, /h-16 w-16/);
  assert.match(source, /sm:h-20 sm:w-20/);
  assert.match(source, /sizes="80px"/);
  assert.doesNotMatch(source, /aspect-square/);
});

test('create resolves only known sample ids and keeps the new direction separate from the seed card', async () => {
  const [page, create] = await Promise.all([readFile(createPageUrl, 'utf8'), readFile(createUrl, 'utf8')]);
  assert.match(page, /getMusicDiscoverSeed\(sampleId\)/);
  assert.match(page, /sampleSeed=\{sampleSeed\}/);
  assert.match(create, /MusicSampleSeedCard seed=\{activeSeed\}/);
  assert.match(create, /buildMusicSamplePrompt\(activeSeed, description\)/);
  assert.match(create, /Add a new direction/);
  assert.match(create, /Review exact quote/);
});

test('Music navigation exposes Discover beside Create', async () => {
  const source = await readFile(navUrl, 'utf8');
  assert.match(source, /href: '\/app\/music\/discover', label: 'Discover'/);
});

test('every Discover string is translated in all eleven languages', async () => {
  const { default: en } = await import('../lib/i18n/messages/en.mjs');
  const keys = Object.keys(en).filter((key) => key.startsWith('musicDiscover.'));
  assert.ok(keys.length >= 50);
  for (const locale of ['ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh']) {
    const { default: catalog } = await import(`../lib/i18n/messages/${locale}.mjs`);
    for (const key of keys) {
      assert.equal(typeof catalog[key], 'string', `${locale} ${key}`);
      const slots = (text) => (text.match(/\{\w+\}/g) || []).sort().join();
      assert.equal(slots(catalog[key]), slots(en[key]), `${locale} ${key} slots`);
    }
  }
});
