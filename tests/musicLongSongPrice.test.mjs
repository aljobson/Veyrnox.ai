import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = (name) => readFile(new URL(`../packages/db/schema/supabase/${name}`, import.meta.url), 'utf8');
const sql = await migration('0563_music_long_song_duration_price.sql');
const functionBody = (text, name) => text.slice(text.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`)).split('END $$;')[0] + 'END $$;';
const quote = functionBody(sql, 'public.music_create_quote');
const custom = functionBody(sql, 'public.music_create_custom_quote');
const submit = functionBody(sql, 'private.music_submit_pair_unbounded');

test('duration CHECK is discovered by column and definition, and 180 seconds is limited to ace-step-1.5', () => {
  assert.match(sql, /FROM pg_catalog\.pg_constraint c/);
  assert.match(sql, /c\.conkey = ARRAY\[a\.attnum\]/);
  assert.match(sql, /pg_catalog\.pg_get_expr\(c\.conbin, c\.conrelid\)/);
  assert.match(sql, /duration_seconds>=10ANDduration_seconds<=60/);
  assert.match(sql, /DROP CONSTRAINT %I', v_constraint\.conname/);
  assert.match(sql, /IF NOT EXISTS \([\s\S]*conrelid = 'public\.music_prompt_specs'::regclass[\s\S]*conname = 'music_prompt_specs_duration_by_model_check'/);
  assert.match(sql, /ADD CONSTRAINT music_prompt_specs_duration_by_model_check CHECK \(\s*duration_seconds BETWEEN 10 AND 60\s*OR \(model_id = 'ace-step-1\.5' AND duration_seconds BETWEEN 10 AND 180\)\s*\)/);
});

test('price blocks use an immutable helper with an empty search path and catalog-independent arithmetic', () => {
  assert.match(sql, /FUNCTION private\.music_duration_price_blocks\(\s*p_model_id TEXT, p_duration_seconds INTEGER\s*\) RETURNS INTEGER\s*LANGUAGE SQL IMMUTABLE SET search_path = '' AS \$\$\s*SELECT CASE WHEN p_model_id = 'ace-step-1\.5'\s*THEN ceil\(p_duration_seconds \/ 60\.0\)::INTEGER ELSE 1 END;/);
});

test('duration validation precedes quote creation and preserves the short-quote response', () => {
  assert.match(quote, /v_max INTEGER;/);
  assert.match(quote, /v_max := CASE WHEN p_model_id = 'ace-step-1\.5' THEN 180 ELSE 60 END;\s*IF p_duration_seconds IS NULL OR p_duration_seconds NOT BETWEEN 10 AND v_max THEN\s*RETURN jsonb_build_object\('ok', false, 'code', 'INVALID_INPUTS'\);/);
  assert.ok(quote.indexOf("'INVALID_INPUTS'") < quote.indexOf('v_result := public.music_create_quote'));
  assert.match(quote, /SET duration_seconds = p_duration_seconds/);
  assert.match(quote, /v_blocks := private\.music_duration_price_blocks\(p_model_id, p_duration_seconds\);\s*IF v_blocks > 1 THEN/);
  assert.match(quote, /END IF;\s*RETURN v_result \|\| jsonb_build_object\('duration_seconds', p_duration_seconds\);\s*END \$\$;/);
});

test('IF conditions do not embed CASE before their THEN token', () => {
  const embeddedCase = /\bIF\b(?:(?!\bTHEN\b)[^;])*\bCASE\b[^;]*\bTHEN\b/i;
  assert.match("IF p_duration_seconds NOT BETWEEN 10 AND\nCASE WHEN p_model_id = 'ace-step-1.5' THEN 180 ELSE 60 END THEN", embeddedCase);
  assert.doesNotMatch(sql, embeddedCase);
});

test('scaling locks only the caller-owned unconsumed quote and sets both prices from the new variable', () => {
  assert.match(quote, /SELECT q\.unit_credits INTO v_base_unit[\s\S]*q\.id = \(v_result->>'quote_id'\)::UUID\s*AND u\.auth_id = p_auth_id AND q\.consumed_at IS NULL\s*FOR UPDATE OF q;/);
  assert.match(quote, /v_new_unit := v_base_unit \* v_blocks;/);
  assert.match(quote, /SET unit_credits = v_new_unit, total_credits = v_new_unit \* q\.output_count[\s\S]*u\.id = q\.user_id AND u\.auth_id = p_auth_id AND q\.consumed_at IS NULL\s*RETURNING q\.\* INTO v_quote;/);
  assert.match(quote, /'unit_credits', v_quote\.unit_credits, 'total_credits', v_quote\.total_credits/);
  assert.match(quote, /'balance_after', \(v_result->>'balance'\)::INTEGER - v_quote\.total_credits/);
  assert.match(quote, /'affordable', \(v_result->>'balance'\)::INTEGER >= v_quote\.total_credits/);
  assert.doesNotMatch(quote, /total_credits = (?:q\.)?unit_credits/);
  assert.doesNotMatch(quote, /FROM public\.model_catalog/);
});

test('custom quote differs from 0478 only in its duration ceiling', async () => {
  const previous = functionBody(await migration('0478_music_custom_instrumental.sql'), 'public.music_create_custom_quote');
  assert.equal(custom, previous.replace('p_duration_seconds NOT BETWEEN 10 AND 60', 'p_duration_seconds NOT BETWEEN 10 AND 180'));
});

test('submit differs from 0550 only in the duration-aware stale-price check', async () => {
  const previous = functionBody(await migration('0550_music_beat_loop_dispatch.sql'), 'private.music_submit_pair_unbounded');
  assert.equal(submit, previous.replace('v_model.credits_5s <> v_quote.unit_credits',
    'v_model.credits_5s *\n           private.music_duration_price_blocks(v_quote.model_id, v_prompt.duration_seconds) <> v_quote.unit_credits'));
});

test('all four functions explicitly revoke; only public wrappers and price helper grant service_role execution', () => {
  const signatures = [
    'private.music_duration_price_blocks(TEXT,INTEGER)',
    'public.music_create_quote(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,TEXT,INTEGER)',
    'public.music_create_custom_quote(TEXT,INTEGER,BOOLEAN,BOOLEAN,INTEGER)',
  ];
  for (const signature of signatures) {
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`));
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`));
  }
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION private.music_submit_pair_unbounded(TEXT,UUID,TEXT) FROM PUBLIC, anon, authenticated, service_role;'));
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION /g) || []).length, 4);
  assert.equal((sql.match(/GRANT EXECUTE ON FUNCTION /g) || []).length, 3);
  assert.doesNotMatch(sql, /GRANT[^;]*\bTO\b[^;]*\b(?:PUBLIC|anon|authenticated)\b/i);
  assert.doesNotMatch(sql, /INSERT INTO public\.ledger_entries|UPDATE public\.credit_balances/i);
  assert.doesNotMatch(sql, /(?:UPDATE|INSERT INTO) public\.model_catalog/i);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION (?:public\.music_submit_pair\(|private\.music_apply_variety_to_dispatch\(|[^\s(]*held[^\s(]*\()/);
});
