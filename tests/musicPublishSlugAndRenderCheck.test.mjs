import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

// 0504 repairs two Music actions that failed on every call:
//  - local WAV render commits, blocked by 0206's surviving jobs_credits_or_free_check;
//  - music_publish_song, which called pgcrypto's gen_random_bytes under search_path=''.
const DIR = new URL('../packages/db/schema/supabase/', import.meta.url);
const read = (name) => readFileSync(new URL(name, DIR), 'utf8');
const code = (sql) => sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');

test('0504 drops the superseded jobs check only when its replacement exists', () => {
  const sql = code(read('0504_music_publish_slug_and_local_render_check.sql'));
  const guard = sql.indexOf("conname = 'jobs_credits_check'");
  const refuse = sql.indexOf('RAISE EXCEPTION');
  const drop = sql.indexOf('ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_credits_or_free_check;');
  assert.ok(guard > 0 && refuse > guard && drop > refuse, 'the existence check and its refusal must come before the drop');
  assert.doesNotMatch(sql, /DROP CONSTRAINT IF EXISTS jobs_credits_check\b/);
  assert.doesNotMatch(sql, /ADD CONSTRAINT/);
});

test('the surviving jobs check still contains the free-allowance rule and only adds the local zero-credit row', () => {
  // The newest definition of jobs_credits_check is the one a fully migrated database holds.
  const defining = readdirSync(DIR)
    .filter((n) => /^\d{4}_.*\.sql$/.test(n))
    .filter((n) => /ADD CONSTRAINT jobs_credits_check CHECK/.test(read(n)))
    .sort();
  const latest = code(read(defining.at(-1)));
  const check = latest.match(/ADD CONSTRAINT jobs_credits_check CHECK \(([\s\S]*?)\);/);
  assert.ok(check, `no jobs_credits_check body in ${defining.at(-1)}`);
  const body = check[1].replace(/\s+/g, ' ').trim();
  assert.ok(body.startsWith('credits > 0 OR free_allowance OR ('), body);
  const zeroCredit = body.match(/credits = 0 AND model_id IN \(([^)]*)\) AND provider = 'local' AND state = 'STORED' \)$/);
  assert.ok(zeroCredit, body);
  const models = [...zeroCredit[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  assert.ok(models.length > 0);
  for (const model of models) assert.match(model, /^music-local-[a-z]+$/, 'only music-local-* models may be zero-credit');
});

test('0504 builds the publication slug from pg_catalog functions only', () => {
  const sql = code(read('0504_music_publish_slug_and_local_render_check.sql'));
  assert.match(sql, /^CREATE OR REPLACE FUNCTION public\.music_publish_song\(/m);
  assert.match(sql, /SECURITY DEFINER SET search_path=''/);
  assert.doesNotMatch(sql, /gen_random_bytes/);
  assert.match(sql, /v_slug := substr\(encode\(sha256\(uuid_send\(gen_random_uuid\(\)\)\|\|uuid_send\(gen_random_uuid\(\)\)\),'hex'\),1,24\);/);
  const signature = 'TEXT,UUID,UUID,TEXT,TEXT,BOOLEAN,BOOLEAN,TEXT,TEXT';
  assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.music_publish_song(${signature}) FROM PUBLIC,anon,authenticated;`));
  assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.music_publish_song(${signature}) TO service_role;`));
});

test('the slug rule in 0463 still accepts what 0504 generates', () => {
  assert.match(read('0463_music_publication.sql'), /slug TEXT NOT NULL UNIQUE CHECK \(slug ~ '\^\[a-f0-9\]\{24\}\$'\)/);
});

test('no migration after 0463 calls gen_random_bytes, which no empty search_path can resolve', () => {
  const offenders = readdirSync(DIR)
    .filter((n) => /^\d{4}_.*\.sql$/.test(n) && n !== '0463_music_publication.sql')
    .filter((n) => /\bgen_random_bytes\s*\(/.test(code(read(n))));
  assert.deepEqual(offenders, []);
});
