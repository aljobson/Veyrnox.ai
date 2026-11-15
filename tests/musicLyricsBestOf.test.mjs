import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MUSIC_BEST_OF_GENRES, musicBestOfEnabled, musicLyricsEnabled, publicBestOf, publicLyrics } from '../lib/musicLyrics.js';

const SLUG = 'a1b2c3d4e5f60718293a4b5c';

test('lyrics are plain text or nothing', () => {
  assert.equal(publicLyrics('  [Verse]\nHello  '), '  [Verse]\nHello  ');
  assert.equal(publicLyrics('   '), null);
  assert.equal(publicLyrics({ html: '<b>x</b>' }), null);
  assert.equal(publicLyrics('x'.repeat(4000)).length, 3000);
});

test('Best of keeps known genres and public fields only, eight tracks at most', () => {
  const tracks = Array.from({ length: 10 }, (_, i) => ({ slug: SLUG, title: `T${i}`, handle: 'creator_one', display_name: 'C', user_id: 'secret', words: ['x'] }));
  const out = publicBestOf({ playlists: [{ genre: 'lo-fi', tracks }, { genre: 'unknown', tracks }, { genre: 'jazz', tracks: [{ slug: 'bad', handle: 'x' }] }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].tracks.length, 8);
  assert.deepEqual(Object.keys(out[0].tracks[0]).sort(), ['display_name', 'handle', 'slug', 'title']);
  assert.equal(MUSIC_BEST_OF_GENRES.length, 12);
});

test('both switches ship false', async () => {
  const on = { MUSIC_RUNTIME_FLAGS: JSON.stringify({ ui: true, schema: true, library: true, distribution: true, publication: true, lyrics: true, bestOf: true }) };
  assert.equal(musicLyricsEnabled(on), true);
  assert.equal(musicBestOfEnabled(on), true);
  assert.equal(musicBestOfEnabled({ ...on, MUSIC_BEST_OF_ENABLED: 'false' }), false);
  const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  // Off in production; on in staging only (owner, 2026-11-15).
  assert.equal((wrangler.match(/\\"lyrics\\":false,\\"bestOf\\":false/g) || []).length, 1);
  assert.equal((wrangler.match(/\\"lyrics\\":true,\\"bestOf\\":true/g) || []).length, 1);
});

test('0535 reads published tracks only, bounded, and grants nothing to browsers', async () => {
  const sql = await readFile(new URL('../packages/db/schema/supabase/0535_music_lyrics_and_best_of.sql', import.meta.url), 'utf8');
  assert.match(sql, /WHERE status = 'published' ORDER BY published_at DESC LIMIT 200/);
  assert.match(sql, /WHERE n <= 8/);
  assert.match(sql, /p\.slug = p_slug AND p\.status = 'published'/);
  assert.match(sql, /user_id = v_user AND status = 'active'/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[^;]*TO (authenticated|anon)/);
  assert.doesNotMatch(sql, /ledger_|credit_balances/);
  const route = await readFile(new URL('../app/api/music/best-of/route.js', import.meta.url), 'utf8');
  assert.doesNotMatch(route, /x-veyrnox-auth/);
});
