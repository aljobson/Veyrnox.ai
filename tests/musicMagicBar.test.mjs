import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { barChoices, loopSeconds, magicQuoteBody, readLayers, requestSeconds, writeLayers } from '../app/veyrnox/_lib/music/beat/magicBar.mjs';
import { musicMagicBarEnabled, parseMusicQuote } from '../lib/musicBackend.js';

test('loop length follows tempo and the provider duration window', () => {
  assert.equal(loopSeconds(120, 8), 16);
  assert.equal(requestSeconds(120, 4), 10);
  assert.equal(requestSeconds(92, 8), 21);
  assert.deepEqual(barChoices(60), [4, 8]);
  assert.deepEqual(barChoices(240), [4, 8, 16]);
});

test('the quote body is one the live Create quote parser accepts, with tempo as a control', () => {
  const body = magicQuoteBody({ prompt: '  Warm Rhodes  ', bpm: 92, bars: 8, title: 'My beat loop' });
  assert.equal(body.model_id, 'ace-step-1.5');
  assert.equal(body.bpm, 92);
  assert.equal(body.duration_seconds, 21);
  assert.match(body.prompt, /^Warm Rhodes\. Instrumental loop, 8 bars of 4\/4 at 92 BPM/);
  const parsed = parseMusicQuote(body);
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.bpm, 92);
});

test('loop layers keep only well-formed private song references', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const good = { songId: 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c', audioUrl: '/api/v1/jobs/b6ed2d0d-8276-4fbb-9c4f-39f401a3158c/asset', title: 'Rhodes A', bars: 8, bpm: 92, muted: false };
  assert.equal(writeLayers('beat', [good, { ...good, songId: 'x', audioUrl: 'https://evil.test/a.mp3' }], storage), true);
  assert.deepEqual(readLayers('beat', storage), [good]);
  assert.deepEqual(readLayers('beat', { getItem: () => { throw new Error('blocked'); } }), []);
  writeLayers('beat', [{ ...good, audioUrl: `/api/v1/jobs/${'-'.repeat(36)}/asset` }], storage);
  assert.deepEqual(readLayers('beat', storage), []);
});

test('Magic Bar needs the beat editor, Create and its own switch, which ships false', async () => {
  const on = { MUSIC_RUNTIME_FLAGS: JSON.stringify({ ui: true, schema: true, generation: true, dispatch: true, beatEditor: true, magicBar: true }) };
  assert.equal(musicMagicBarEnabled(on), true);
  assert.equal(musicMagicBarEnabled({ ...on, MUSIC_MAGIC_BAR_ENABLED: 'false' }), false);
  assert.equal(musicMagicBarEnabled({ ...on, MUSIC_BEAT_EDITOR_ENABLED: 'false' }), false);
  const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.equal((wrangler.match(/\\"magicBar\\":false/g) || []).length, 2);
  const editor = await readFile(new URL('../app/veyrnox/_components/music/beat/BeatEditor.jsx', import.meta.url), 'utf8');
  assert.match(editor, /\{magicBar && <BeatMagicBar/);
});
