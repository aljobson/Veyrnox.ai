import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

// Postgres rejects a regex repetition above 255 ("invalid repetition count(s)").
// 0479-0482 and 0487-0489 shipped '{1,2000}' and every Music editing submit
// function failed at run time; 0501 replaces those functions. Older files stay
// as applied, so only they are allowed to carry the bound.
const DIR = new URL('../packages/db/schema/supabase/', import.meta.url);
const SHIPPED_BEFORE_FIX = new Set([
  '0479_music_source_cover.sql',
  '0480_music_stem_archives.sql',
  '0481_music_tail_extend.sql',
  '0482_music_replace_section.sql',
  '0487_music_add_section.sql',
  '0488_music_target_stem_pair.sql',
  '0489_music_track_add.sql',
]);
const POSIX_REGEX_LITERAL = /!?~\*?\s*'((?:[^']|'')*)'/g;
const BOUND = /\{(\d+)(?:,(\d*))?\}/g;

function oversizedBounds(sql) {
  const found = [];
  for (const line of sql.split('\n')) {
    if (line.trimStart().startsWith('--')) continue;
    for (const [, pattern] of line.matchAll(POSIX_REGEX_LITERAL)) {
      for (const [, lo, hi] of pattern.matchAll(BOUND)) {
        const top = Number(hi || lo);
        if (top > 255) found.push(`{${lo}${hi === undefined ? '' : ','}${hi ?? ''}}`);
      }
    }
  }
  return found;
}

test('no migration after the fix uses a regex repetition above 255', () => {
  const offenders = [];
  for (const name of readdirSync(DIR).filter((n) => /^\d{4}_.*\.sql$/.test(n))) {
    if (SHIPPED_BEFORE_FIX.has(name)) continue;
    const bad = oversizedBounds(readFileSync(new URL(name, DIR), 'utf8'));
    if (bad.length) offenders.push(`${name}: ${bad.join(', ')}`);
  }
  assert.deepEqual(offenders, []);
});

test('the checker flags the bound that broke the seven functions', () => {
  assert.deepEqual(oversizedBounds("IF u !~ '^https://[^[:space:]]{1,2000}$' THEN"), ['{1,2000}']);
  assert.deepEqual(oversizedBounds("IF k !~ '^[A-Za-z0-9._-]{8,120}$' THEN"), []);
});

test('0501 rewrites all seven submit functions without the oversized bound', () => {
  const sql = readFileSync(new URL('0501_music_source_url_regex.sql', DIR), 'utf8');
  assert.deepEqual(oversizedBounds(sql), []);
  assert.equal((sql.match(/^CREATE OR REPLACE FUNCTION public\.music_submit_/gm) ?? []).length, 7);
  assert.equal((sql.match(/length\(p_source_audio_url\) > 2008/g) ?? []).length, 7);
  assert.equal((sql.match(/^REVOKE ALL ON FUNCTION public\.music_submit_/gm) ?? []).length, 7);
  assert.equal((sql.match(/^GRANT EXECUTE ON FUNCTION public\.music_submit_.* TO service_role;/gm) ?? []).length, 7);
});
