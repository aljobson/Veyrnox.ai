import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getMusicDiscoverSeed } from '../lib/musicDiscover.js';
import { musicLabsEnabled } from '../lib/musicBackend.js';

test('every wheel pick is a seed that Create accepts', async () => {
  const { LAB_GENRES, spinGenre } = await import('../app/veyrnox/_lib/music/labs.mjs');
  assert.equal(LAB_GENRES.length, 20);
  for (let i = 0; i < 50; i += 1) {
    const pick = spinGenre(() => (i % 10) / 10);
    assert.equal(getMusicDiscoverSeed(pick.seed.id)?.mood, pick.genre);
  }
});

test('Labs is behind its own switch, spends nothing and links only to Create and Beats', async () => {
  assert.equal(musicLabsEnabled({ MUSIC_RUNTIME_FLAGS: JSON.stringify({ ui: true, labs: true }) }), true);
  assert.equal(musicLabsEnabled({ MUSIC_RUNTIME_FLAGS: JSON.stringify({ ui: true }) }), false);
  const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  // Off in production; on in staging only (owner, 2026-11-15).
  assert.equal((wrangler.match(/\\"labs\\":false/g) || []).length, 1);
  assert.equal((wrangler.match(/\\"labs\\":true/g) || []).length, 1);
  const src = await readFile(new URL('../app/veyrnox/_components/music/MusicLabs.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /gatewayFetch|fetch\(/);
  assert.match(src, /\/app\/music\/create\?sample=\$\{encodeURIComponent\(pick\.seed\.id\)\}/);
  const page = await readFile(new URL('../app/veyrnox/app/music/labs/page.js', import.meta.url), 'utf8');
  assert.match(page, /if \(!musicLabsEnabled\(\)\) notFound\(\);/);
});
