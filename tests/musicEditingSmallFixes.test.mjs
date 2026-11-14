import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// 0510: four small Music editing fixes, each proven on staging in a rolled-back transaction.
const sql = readFileSync(new URL('../packages/db/schema/supabase/0510_music_editing_small_fixes.sql', import.meta.url), 'utf8');
const code = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const fn = (name) => {
  const start = code.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, name);
  return code.slice(start, code.indexOf('$$;', start) + 3);
};

test('only a preview-only crop is unrendered; provider-made versions can be downloaded', () => {
  const body = fn('music_get_version_exportability');
  assert.match(body, /'rendered',COALESCE\(v\.provenance->>'render_state','canonical'\)<>'preview_only'/);
  assert.doesNotMatch(body, /v\.operation='generation' OR/);
});

test('a refused track debit is reported as a refusal, never as the upload debit', () => {
  const body = fn('music_submit_track_add_request');
  assert.doesNotMatch(body, /RETURN COALESCE\(v_track_debit,v_upload_debit/);
  assert.match(body, /WHEN v_track_debit IS NOT NULL AND v_track_debit->>'ok' IS DISTINCT FROM 'true' THEN v_track_debit/);
  assert.match(body, /WHEN v_upload_debit IS NOT NULL AND v_upload_debit->>'ok' IS DISTINCT FROM 'true' THEN v_upload_debit/);
  assert.match(body, /ELSE jsonb_build_object\('ok',false,'code','DEBIT_FAILED'\) END;/);
});

test('the target-stem tier is taken from the stored, rounded duration', () => {
  const body = fn('music_create_target_stem_quote');
  for (const edge of [30, 60, 90]) assert.ok(body.includes(`round(p_source_duration_seconds,3)<=${edge}`), String(edge));
  assert.match(body, /round\(p_source_duration_seconds,3\),v_credits,v_model\.updated_at/);
});

test('stems count stem and target-stem requests against one limit', () => {
  const body = fn('music_submit_stem_request');
  assert.match(body, /FROM public\.music_stem_requests r JOIN public\.jobs j/);
  assert.match(body, /FROM public\.music_target_stem_requests r JOIN public\.jobs j/);
  assert.match(body, /IF v_active>=2 THEN RETURN jsonb_build_object\('ok',false,'code','CONCURRENCY_LIMIT'\)/);
  assert.doesNotMatch(body, /'CREATED'/);
});

test('every recreated function keeps its security settings and privileges', () => {
  for (const [name, sig] of [
    ['music_get_version_exportability', 'TEXT,UUID,UUID'],
    ['music_submit_track_add_request', 'TEXT,UUID,UUID,TEXT,TEXT'],
    ['music_create_target_stem_quote', 'TEXT,UUID,UUID,TEXT,BOOLEAN,NUMERIC'],
    ['music_submit_stem_request', 'TEXT,UUID,UUID,TEXT,TEXT'],
  ]) {
    assert.match(fn(name), /SECURITY DEFINER SET search_path=''/, name);
    assert.ok(code.includes(`REVOKE ALL ON FUNCTION public.${name}(${sig}) FROM PUBLIC,anon,authenticated;`), name);
    assert.ok(code.includes(`GRANT EXECUTE ON FUNCTION public.${name}(${sig}) TO service_role;`), name);
  }
  assert.doesNotMatch(code, /INSERT INTO public\.ledger_entries|UPDATE public\.credit_balances/);
});
