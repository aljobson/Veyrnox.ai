import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../packages/db/schema/supabase/0597_crun_qwen3_tts_activate.sql', import.meta.url), 'utf8');
test('Qwen activation updates exactly the proved route and catalog row, each with an exact ROW_COUNT assert', () => {
    assert.equal((sql.match(/\bUPDATE public\./g) || []).length, 2);
    assert.equal((sql.match(/GET DIAGNOSTICS affected = ROW_COUNT;/g) || []).length, 2);
    assert.match(sql, /IF affected <> 1 THEN\s+RAISE EXCEPTION 'Expected one Crun route to activate/);
    assert.match(sql, /IF affected <> 1 THEN\s+RAISE EXCEPTION 'Expected one qwen3-tts catalog row to activate/);
    assert.match(sql, /state IN \('standby', 'active'\)/, 'replay-safe predicate');
    assert.match(sql, /SET active = true/);
    assert.match(sql, /cost_per_unit = 0\.0089/);
});
test('the route is made active with a parity record that names both staging proofs', () => {
    assert.match(sql, /parity_record = 'proofs 2026-11-23/);
    assert.match(sql, /f15d230b-ebd7-4170-9034-68ed7dff119c/);
    assert.match(sql, /eacc8d53-828d-4653-849a-32f6955b556e/);
    assert.match(sql, /Covers voice Cherry only/);
});
test('activation never writes ledger or balances and never creates objects', () => {
    assert.doesNotMatch(sql, /ledger_entries|credit_balances|CREATE (?:TABLE|FUNCTION)|DROP |DELETE FROM/i);
});
test('it follows the Qwen staging migration', () => {
    assert.ok(readFileSync(new URL('../packages/db/schema/supabase/0596_crun_qwen3_tts_speech.sql', import.meta.url), 'utf8').includes("'standby'"));
});
