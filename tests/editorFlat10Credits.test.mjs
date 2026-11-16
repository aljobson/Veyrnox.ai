import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 0547: the three paid editor actions share one flat price, held in the catalog only.
const sql = readFileSync(new URL('../packages/db/schema/supabase/0547_editor_flat_10_credits.sql', import.meta.url), 'utf8');

test('0547 sets 10 credits on the AI edit, Speech Cut and export rows', () => {
    assert.match(sql, /SET credits_5s=10[^;]*WHERE id='editor-ai-edit-gemini-3\.8-flash' AND provider='openrouter-chat'/s);
    assert.match(sql, /SET credits_5s=10[^;]*WHERE id='elevenlabs-scribe-v2' AND provider='fal'/s);
    assert.match(sql, /'\{"flat_credits":10\}'::jsonb[^;]*WHERE id='editor-server-render' AND provider='concat-render'/s);
});

test('0547 asserts one row for each update and never writes the ledger', () => {
    assert.equal((sql.match(/IF affected <> 1 THEN RAISE EXCEPTION/g) || []).length, 3);
    assert.doesNotMatch(sql, /ledger_entries|credit_balances/);
});
