import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(`../packages/db/schema/supabase/${name}`, import.meta.url), 'utf8');
test('both new cron registrations are extension-guarded and unscheduled before rescheduling', () => {
    for (const [name, job] of [['0450_editor_ai_edit_settle.sql', 'veyrnox-purge-editor-ai-edit'], ['0451_speech_analyses.sql', 'veyrnox-sweep-stuck-jobs']]) {
        const sql = read(name), block = sql.match(/DO \$cron\$[\s\S]*?END \$cron\$;/)?.[0]; assert.ok(block);
        assert.match(block, /IF NOT EXISTS \(SELECT 1 FROM pg_extension WHERE extname='pg_cron'\) THEN RETURN; END IF;/);
        assert.ok(block.indexOf('cron.unschedule') < block.indexOf('cron.schedule(')); assert.ok(block.includes(job)); assert.match(block, /'\*\/10 \* \* \* \*'/);
    }
    assert.match(read('0450_editor_ai_edit_settle.sql'), /CREATE INDEX IF NOT EXISTS jobs_editor_ai_edit_expiry ON public.jobs\(editor_ai_edit_expires_at\)\s+WHERE editor_ai_edit_result IS NOT NULL/);
});
test('creation delete preserves latest scan/hold checks with only the kind refusal expanded', () => {
    const extract = sql => sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.delete_user_job')).split('GRANT EXECUTE ON FUNCTION public.delete_user_job')[0];
    const previous = extract(read('0447_scan_hold_and_clawback_hardening.sql'));
    assert.equal(extract(read('0450_editor_ai_edit_settle.sql')), previous.replace("v_job.inputs->>'kind' = 'chat'", "v_job.inputs->>'kind' IN ('chat','editor_ai_edit','speech_analysis')"));
});
test('speech admission locks the balance before checking cross-feature identity and only calls ledger_debit', () => {
    const sql = read('0451_speech_analyses.sql');
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.speech_analysis_request'), sql.indexOf('REVOKE ALL ON FUNCTION public.speech_analysis_request'));
    assert.ok(fn.indexOf('public.credit_balances WHERE user_id=u FOR UPDATE') < fn.indexOf('EXISTS(SELECT 1 FROM public.jobs WHERE user_id=u AND idempotency_key=p_key)'));
    assert.ok(fn.indexOf('RETURN public.speech_analysis_by_key') < fn.indexOf('SELECT * INTO probe'));
    assert.match(fn, /public.ledger_debit\(/); assert.doesNotMatch(sql, /INSERT INTO public.ledger_entries|UPDATE public.credit_balances/);
});
