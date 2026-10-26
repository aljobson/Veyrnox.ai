import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export async function quoteDatabaseTests(t, { query, json, authId, userId }) {
    const migration = readFileSync(new URL('../../packages/db/schema/supabase/0398_editor_server_render_quote.sql', import.meta.url), 'utf8');
    await t.test('quote migration replays and leaves one admit signature with service-only privileges', async () => {
        await query(migration); await query(migration);
        assert.equal(await query("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admit_server_render';"), '1');
        for (const signature of ['public.quote_server_render(numeric,text)', 'public.admit_server_render(text,text,jsonb,text,numeric,text,integer)']) {
            assert.equal(await query(`SELECT NOT EXISTS(SELECT 1 FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='${signature}'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE');`), 't', 'PUBLIC cannot execute');
            for (const role of ['anon', 'authenticated', 'service_role']) assert.equal(await query(`SELECT has_function_privilege('${role}','${signature}','EXECUTE');`), role === 'service_role' ? 't' : 'f', role);
            assert.equal(await query(`SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='${signature}'::regprocedure;`), 't');
        }
        assert.equal((await json("SET ROLE service_role; SELECT public.quote_server_render(10,'1080p');")).credits, 1);
    });
    await t.test('quote equals actual ledger debit at both resolutions and billing boundaries', async () => {
        for (const resolution of ['1080p', '720p']) {
            for (const seconds of [.01, 10, 10.03, 15, 15.03, resolution === '1080p' ? 120 : 300]) {
                const quote = await json(`SELECT public.quote_server_render(${seconds},'${resolution}');`);
                const expected = Math.ceil(seconds / (resolution === '1080p' ? 10 : 15));
                assert.equal(quote.credits, expected);
                assert.equal(quote.max_seconds, resolution === '1080p' ? 120 : 300);
                const admitted = await json(`SELECT public.admit_server_render('${authId}','quoted-${resolution}-${seconds}','{}'::jsonb,'${resolution}',${seconds},'Quote test',${quote.credits});`);
                assert.equal(admitted.credits, quote.credits);
                assert.equal(await query(`SELECT -delta FROM public.ledger_entries WHERE job_id='${admitted.job_id}' AND delta<0;`), String(quote.credits));
                await query(`SELECT public.fail_server_render('${admitted.job_id}','user_cancelled'); UPDATE public.jobs SET created_at=now()-interval '2 minutes' WHERE id='${admitted.job_id}';`);
            }
        }
    });
    await t.test('catalog change after quote rejects admission without a debit or job', async () => {
        const quote = await json("SELECT public.quote_server_render(10.03,'1080p');");
        const before = await query(`SELECT jsonb_build_array((SELECT count(*) FROM public.jobs),(SELECT count(*) FROM public.ledger_entries),(SELECT balance FROM public.credit_balances WHERE user_id='${userId}'));`);
        try {
            await query("UPDATE public.model_catalog SET credits_5s=2 WHERE id='editor-server-render';");
            const result = await json(`SELECT public.admit_server_render('${authId}','price-change-new','{}'::jsonb,'1080p',10.03,'Quote test',${quote.credits});`);
            assert.deepEqual(result, { ok: false, code: 'PRICE_CHANGED' });
            assert.equal(await query(`SELECT jsonb_build_array((SELECT count(*) FROM public.jobs),(SELECT count(*) FROM public.ledger_entries),(SELECT balance FROM public.credit_balances WHERE user_id='${userId}'));`), before);
        } finally { await query("UPDATE public.model_catalog SET credits_5s=1 WHERE id='editor-server-render';"); }
    });
    await t.test('replay ignores changed or disabled pricing and preserves original job, state and debit', async () => {
        const admit = `SELECT public.admit_server_render('${authId}','price-change-replay','{}'::jsonb,'1080p',10.03,'Quote test',2);`;
        const first = await json(admit);
        try {
            await query("UPDATE public.model_catalog SET credits_5s=9,active=false WHERE id='editor-server-render';");
            const replay = await json(admit);
            assert.equal(replay.job_id, first.job_id); assert.equal(replay.credits, 2); assert.equal(replay.state, first.state); assert.equal(replay.idempotent, true);
            assert.equal(await query(`SELECT count(*) FROM public.ledger_entries WHERE job_id='${first.job_id}' AND delta<0;`), '1');
            await query(`SELECT public.fail_server_render('${first.job_id}','user_cancelled');`);
            assert.equal((await json(admit)).state, 'REFUNDED');
        } finally { await query("UPDATE public.model_catalog SET credits_5s=1,active=true WHERE id='editor-server-render';"); }
    });
}
