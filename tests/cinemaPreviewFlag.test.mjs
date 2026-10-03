import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cinemaPreviewEnabled } from '../app/veyrnox/social-cinema/preview.js';

function withStorage(value, fn) {
  const had = 'localStorage' in globalThis;
  const prev = globalThis.localStorage;
  globalThis.localStorage = value;
  try { return fn(); } finally { if (had) globalThis.localStorage = prev; else delete globalThis.localStorage; }
}

test("the Cinema preview flag accepts '1' and 'true', nothing else", () => {
  const stored = (v) => ({ getItem: (k) => (k === 'veyrnox_social_cinema' ? v : null) });
  assert.equal(withStorage(stored('1'), cinemaPreviewEnabled), true);
  assert.equal(withStorage(stored('true'), cinemaPreviewEnabled), true);
  for (const v of [null, '', '0', 'false', 'yes']) assert.equal(withStorage(stored(v), cinemaPreviewEnabled), false, String(v));
});

test('the Cinema preview flag is off when storage throws', () => {
  assert.equal(withStorage({ getItem() { throw new Error('blocked'); } }, cinemaPreviewEnabled), false);
});

test('every Cinema surface reads the flag through the one helper', () => {
  for (const p of ['SocialCinema.js', 'creator/CreatorWorkspace.js', 'pass/PassPanel.js']) {
    const src = readFileSync(new URL(`../app/veyrnox/social-cinema/${p}`, import.meta.url), 'utf8');
    assert.match(src, /setPreview\(cinemaPreviewEnabled\(\)\)/, p);
    assert.doesNotMatch(src, /getItem\('veyrnox_social_cinema'\)/, p);
  }
});
