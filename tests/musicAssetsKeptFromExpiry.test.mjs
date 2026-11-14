import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

// 0509: expire_assets deletes its batch in one statement. A Music file still used by a
// song version or a target stem is pinned ON DELETE RESTRICT, so it would fail the whole
// batch and stall file expiry for everyone. Such files are skipped.
const DIR = new URL('../packages/db/schema/supabase/', import.meta.url);
const read = (name) => readFileSync(new URL(name, DIR), 'utf8');
const code = read('0509_music_assets_kept_from_expiry.sql').split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

test('expiry skips files a song version or a target stem still uses', () => {
  assert.match(code, /NOT EXISTS \(SELECT 1 FROM public\.music_song_versions v WHERE v\.audio_asset_id = a\.id\)/);
  assert.match(code, /NOT EXISTS \(SELECT 1 FROM public\.music_target_stem_assets t\s+WHERE t\.target_asset_id = a\.id OR t\.residual_asset_id = a\.id\)/);
});

test('the rest of 0447 is kept: expiry, holds, SKIP LOCKED, the reap queue and privileges', () => {
  assert.match(code, /a\.expires_at IS NOT NULL AND a\.expires_at <= now\(\) AND a\.held_at IS NULL/);
  assert.match(code, /FOR UPDATE OF a SKIP LOCKED/);
  assert.match(code, /INSERT INTO public\.asset_reap_queue \(r2_key\)/);
  assert.match(code, /SECURITY DEFINER SET search_path = ''/);
  assert.ok(code.includes('REVOKE ALL ON FUNCTION public.expire_assets(INT) FROM PUBLIC, anon, authenticated;'));
  assert.ok(code.includes('GRANT EXECUTE ON FUNCTION public.expire_assets(INT) TO service_role;'));
});

test('every ON DELETE RESTRICT reference to assets is skipped by expiry', () => {
  // A new table that pins assets ON DELETE RESTRICT must be added to expire_assets too,
  // or the first due row stalls expiry again. Pairs are (table, column), so a new table
  // reusing a column name already handled elsewhere is still caught.
  const pins = new Set();
  for (const name of readdirSync(DIR).filter((n) => /^\d{4}_.*\.sql$/.test(n))) {
    const sql = read(name).replace(/--[^\n]*/g, '');
    for (const table of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? public\.(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      for (const m of table[2].matchAll(/(\w+)\s+UUID[^,\n]*REFERENCES public\.assets\(id\) ON DELETE RESTRICT/gi)) pins.add(`${table[1]}.${m[1]}`);
    }
    for (const m of sql.matchAll(/ALTER TABLE public\.(\w+)[^;]*?ADD COLUMN(?: IF NOT EXISTS)? (\w+)\s+UUID[^;]*?REFERENCES public\.assets\(id\) ON DELETE RESTRICT/gi)) pins.add(`${m[1]}.${m[2]}`);
  }
  assert.ok(pins.size > 0, 'no RESTRICT reference found: the scan is broken');
  for (const pin of pins) {
    const [table, column] = pin.split('.');
    const clause = code.match(new RegExp(`FROM public\\.${table} (\\w+)[^)]*?\\b\\1\\.${column} = a\\.id`));
    assert.ok(clause, `expire_assets must skip ${pin}`);
  }
});

test('the pair scan would catch a new table that reuses a pinned column name', () => {
  const clause = (table, column) => code.match(new RegExp(`FROM public\\.${table} (\\w+)[^)]*?\\b\\1\\.${column} = a\\.id`));
  assert.ok(clause('music_song_versions', 'audio_asset_id'));
  assert.equal(clause('some_new_table', 'audio_asset_id'), null);
});
