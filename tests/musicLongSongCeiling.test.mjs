import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MUSIC_LONG_SONG_MAX } from '../lib/musicLongSongs.js';
import { FLAC_TO_WAV_MAX_OUTPUT_BYTES } from '../lib/flacToWav.js';

const migration = name => readFile(new URL(`../packages/db/schema/supabase/${name}`, import.meta.url), 'utf8');
const previous = await migration('0563_music_long_song_duration_price.sql');
const sql = await migration('0567_music_long_song_ceiling_135.sql');
const functionBody = (text, name) => {
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = text.indexOf('END $$;', start);
  assert.notEqual(end, -1, `${name} must have a complete body`);
  return text.slice(start, end + 'END $$;'.length);
};

test('the long-song ceiling fits 48 kHz stereo 16-bit PCM and its WAV header under the conversion cap', () => {
  assert.equal(MUSIC_LONG_SONG_MAX, 135);
  assert.ok(MUSIC_LONG_SONG_MAX * 48000 * 2 * 2 + 44 <= FLAC_TO_WAV_MAX_OUTPUT_BYTES);
});

for (const name of ['public.music_create_quote', 'public.music_create_custom_quote']) {
  test(`${name} differs from 0563 only in its 135-second ceiling`, () => {
    assert.equal(functionBody(sql, name), functionBody(previous, name).replaceAll('180', '135'));
  });
}

test('existing over-limit snapshots fail loudly before the named CHECK is replaced', () => {
  assert.match(sql, /IF EXISTS \(\s*SELECT 1 FROM public\.music_prompt_specs WHERE duration_seconds > 135\s*\) THEN\s*RAISE EXCEPTION '[^']+';\s*END IF;/);
  assert.ok(sql.indexOf('RAISE EXCEPTION') < sql.indexOf('DROP CONSTRAINT'));
  assert.match(sql, /ALTER TABLE public\.music_prompt_specs\s*DROP CONSTRAINT IF EXISTS music_prompt_specs_duration_by_model_check;/);
  assert.match(sql, /IF NOT EXISTS \(\s*SELECT 1 FROM pg_catalog\.pg_constraint\s*WHERE conrelid = 'public\.music_prompt_specs'::regclass\s*AND conname = 'music_prompt_specs_duration_by_model_check'\s*\) THEN/);
  assert.match(sql, /ADD CONSTRAINT music_prompt_specs_duration_by_model_check CHECK \(\s*duration_seconds BETWEEN 10 AND 60\s*OR \(model_id = 'ace-step-1\.5' AND duration_seconds BETWEEN 10 AND 135\)\s*\)/);
});

test('full-signature grants and revokes match 0563 and expose no functions to browser roles', () => {
  const privileges = text => text.match(/(?:REVOKE ALL|GRANT EXECUTE) ON FUNCTION public\.music_create_(?:custom_)?quote\([^;]+;/g);
  assert.deepEqual(privileges(sql), privileges(previous));
  assert.equal(privileges(sql).length, 4);
  assert.equal((sql.match(/GRANT EXECUTE ON FUNCTION /g) || []).length, 2);
  assert.doesNotMatch(sql, /GRANT[^;]*\bTO\b[^;]*\b(?:PUBLIC|anon|authenticated)\b/i);
});

test('the ceiling migration leaves the price helper, submit, catalog and credit writes alone', () => {
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION /g) || []).length, 2);
  assert.doesNotMatch(sql, /(?:CREATE OR REPLACE|ALTER|DROP) FUNCTION private\./i);
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE(?: TABLE)?)\s+(?:public\.)?(?:ledger_entries|credit_balances|model_catalog)\b/i);
});
