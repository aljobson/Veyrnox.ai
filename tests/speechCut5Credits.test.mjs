import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 0566: Speech Cut (shared with Best Cut's speech analysis) drops from 10 to 5 credits; nothing else moves.
// Comments name the other rows to say they are untouched; assert on the statements only.
const sql = readFileSync(new URL('../packages/db/schema/supabase/0566_speech_cut_5_credits.sql', import.meta.url), 'utf8')
    .split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

test('0566 sets 5 credits on the speech analysis row only', () => {
    assert.match(sql, /SET credits_5s=5[^;]*WHERE id='elevenlabs-scribe-v2' AND provider='fal'/s);
    assert.equal((sql.match(/UPDATE public\.model_catalog/g) || []).length, 1);
    assert.doesNotMatch(sql, /editor-ai-edit|editor-server-render|flat_credits/);
});

test('0566 asserts exactly one row and never writes the ledger', () => {
    assert.equal((sql.match(/IF affected <> 1 THEN RAISE EXCEPTION/g) || []).length, 1);
    assert.doesNotMatch(sql, /ledger_entries|credit_balances|DELETE|TRUNCATE/);
});

test('5 credits stays above the ADR-0014 margin floor for the worst-case analysis', () => {
    const perCredit = 0.01796;
    const worstCaseCost = 0.008; // 60 s clip at the documented $0.008/min rate
    assert.ok(5 * perCredit >= worstCaseCost * 2, 'revenue must be at least twice the provider cost');
});
