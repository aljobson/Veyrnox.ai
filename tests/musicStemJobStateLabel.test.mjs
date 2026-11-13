import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

// public.jobs.state is the enum job_state. A literal that is not one of its
// labels is accepted by CREATE FUNCTION and rejected on first execution (22P02).
// 0480 and 0488 compared it with 'CREATED', so Stems and Target stems could never
// be submitted; 0501 carried that over and 0503 corrects it.
const SCHEMA = new URL('../packages/db/schema/', import.meta.url);
const DIR = new URL('supabase/', SCHEMA);
const SHIPPED_BEFORE_FIX = new Set([
  '0480_music_stem_archives.sql',
  '0488_music_target_stem_pair.sql',
  '0501_music_source_url_regex.sql',
]);

function jobStateLabels() {
  const initial = readFileSync(new URL('0001_initial.sql', SCHEMA), 'utf8');
  const body = initial.match(/CREATE TYPE job_state AS ENUM \(([\s\S]*?)\);/);
  assert.ok(body, 'job_state enum definition not found');
  return new Set([...body[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]));
}

// `j.state` is the alias the Music functions use for public.jobs.
const JOB_STATE_COMPARISON = /\bj\.state\s*(?:IN\s*\(([^)]*)\)|(?:=|<>|!=)\s*('[^']*'))/g;

function badJobStateLiterals(sql, labels) {
  const bad = [];
  for (const line of sql.split('\n')) {
    if (line.trimStart().startsWith('--')) continue;
    for (const [, list, single] of line.matchAll(JOB_STATE_COMPARISON)) {
      for (const [, literal] of (list ?? single).matchAll(/'([^']*)'/g)) {
        if (!labels.has(literal)) bad.push(literal);
      }
    }
  }
  return bad;
}

test('the checker flags a label that job_state does not have', () => {
  const labels = jobStateLabels();
  assert.deepEqual([...labels].sort(), ['DEBITED', 'FAILED', 'FAILOVER', 'PRICED', 'REFUNDED', 'STORED', 'SUBMITTED', 'SUCCEEDED']);
  assert.deepEqual(badJobStateLiterals("WHERE j.state IN ('CREATED','SUBMITTED','SUCCEEDED');", labels), ['CREATED']);
  assert.deepEqual(badJobStateLiterals("WHERE j.state IN ('DEBITED','SUBMITTED','SUCCEEDED');", labels), []);
  assert.deepEqual(badJobStateLiterals("CASE WHEN j.state='STORED' THEN 'ready'", labels), []);
});

test('no migration after the fix compares jobs.state with an unknown label', () => {
  const labels = jobStateLabels();
  const offenders = [];
  for (const name of readdirSync(DIR).filter((n) => /^\d{4}_.*\.sql$/.test(n))) {
    if (SHIPPED_BEFORE_FIX.has(name)) continue;
    const bad = badJobStateLiterals(readFileSync(new URL(name, DIR), 'utf8'), labels);
    if (bad.length) offenders.push(`${name}: ${bad.join(', ')}`);
  }
  assert.deepEqual(offenders, []);
});

test('0503 recreates both stem submit functions with the DEBITED label', () => {
  const sql = readFileSync(new URL('0503_music_stem_job_state_label.sql', DIR), 'utf8');
  const code = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
  assert.doesNotMatch(code, /'CREATED'/);
  assert.equal((code.match(/j\.state IN \('DEBITED','SUBMITTED','SUCCEEDED'\)/g) ?? []).length, 3);
  for (const fn of ['music_submit_stem_request', 'music_submit_target_stem_request']) {
    assert.match(code, new RegExp(`^CREATE OR REPLACE FUNCTION public\\.${fn}\\(`, 'm'));
    assert.match(code, new RegExp(`^REVOKE ALL ON FUNCTION public\\.${fn}\\(TEXT,UUID,UUID,TEXT,TEXT\\) FROM PUBLIC,anon,authenticated;`, 'm'));
    assert.match(code, new RegExp(`^GRANT EXECUTE ON FUNCTION public\\.${fn}\\(TEXT,UUID,UUID,TEXT,TEXT\\) TO service_role;`, 'm'));
  }
  assert.equal((code.match(/length\(p_source_audio_url\) > 2008/g) ?? []).length, 2);
  assert.match(code, /SECURITY DEFINER SET search_path=''/);
});
