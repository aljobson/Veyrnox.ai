#!/usr/bin/env node
// 0206 (ADR-0069 step 2): free-allowance jobs and the zero-credit refund branch. Runs against the full migration
// replay (ledger-tests.yml), like the other scripts that need the modern ledger. Fixtures are committed so the
// concurrency case can use real connections; the replay database is throwaway.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: url, max: 12 });
const one = async (sql, args = []) => (await pool.query(sql, args)).rows[0];
const MODEL = `fa-jobs-${randomUUID().slice(0, 8)}`;
const CHAT = `fa-chat-${randomUUID().slice(0, 8)}`;

const submit = async (user, key, limit = 0) =>
    (await one('SELECT public.submit_free_job($1, $2, $3, $4::jsonb, $5, 60) AS r', [user, key, MODEL, JSON.stringify({ prompt: 'x' }), limit])).r;
const refund = async (job, user, credits) =>
    (await one('SELECT public.ledger_refund($1, $2, $3, $4) AS r', [job, user, credits, 'refund:provider_failed'])).r;
const setAllowance = (perDay, budget) => pool.query(
    'UPDATE public.model_catalog SET free_allowance_per_day = $2, free_allowance_daily_budget = $3, active = true WHERE id = $1', [MODEL, perDay, budget]);
const setChat = (perDay, budget) => pool.query(
    'UPDATE public.model_catalog SET free_allowance_per_day = $2, free_allowance_daily_budget = $3, active = true WHERE id = $1', [CHAT, perDay, budget]);
const authOf = async (user) => (await one('SELECT auth_id FROM public.users WHERE id = $1', [user])).auth_id;
const balance = async (user) => one('SELECT balance, free_balance FROM public.credit_balances WHERE user_id = $1', [user]);
const claim = async (user, key) => (await one('SELECT state FROM public.model_free_allowance_claims WHERE user_id = $1 AND idempotency_key = $2', [user, key]))?.state;
const ledgerRows = async (job) => (await one('SELECT count(*)::int AS n FROM public.ledger_entries WHERE job_id = $1', [job])).n;
async function user({ confirmed = true } = {}) {
    const auth = randomUUID();
    await pool.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, $3)', [auth, `${auth}@example.invalid`, confirmed ? new Date() : null]);
    return (await one('SELECT id FROM public.users WHERE auth_id = $1', [auth])).id;
}

let failed = 0;
async function check(name, fn) {
    try { await setAllowance(3, 100); await fn(); console.log(`  ok  ${name}`); }
    catch (err) { failed += 1; console.error(`  FAIL ${name}\n       ${err.message}`); }
}

try {
    // Replays are safe: the migration is idempotent.
    const migration = await readFile(new URL('../packages/db/schema/supabase/0206_free_allowance_jobs.sql', import.meta.url), 'utf8');
    await pool.query(migration);
    await pool.query(`INSERT INTO public.model_catalog
        (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
        VALUES ($1, 'Free allowance jobs test', 'fal', $2, 'text-to-image', 1, 0.0100, 'per_generation', NULL, false, false)`, [MODEL, `fal-ai/${MODEL}`]);

    await check('creates a 0-credit job with no ledger row and leaves the balance alone', async () => {
        const u = await user(); const before = await balance(u);
        const r = await submit(u, 'free-1');
        assert.deepEqual([r.ok, r.taken, r.idempotent], [true, true, false], JSON.stringify(r));
        assert.deepEqual(await one('SELECT credits, free_allowance, state FROM public.jobs WHERE id = $1', [r.job_id]),
            { credits: 0, free_allowance: true, state: 'DEBITED' });
        assert.equal(await ledgerRows(r.job_id), 0);
        assert.deepEqual(await balance(u), before);
        assert.equal(await claim(u, 'free-1'), 'TAKEN');
    });

    await check('a replay returns the same job and takes nothing more', async () => {
        const u = await user();
        const a = await submit(u, 'rep-1'); const b = await submit(u, 'rep-1');
        assert.equal(b.job_id, a.job_id); assert.equal(b.idempotent, true);
        assert.equal((await one('SELECT count(*)::int AS n FROM public.model_free_allowance_claims WHERE user_id = $1', [u])).n, 1);
    });

    await check('with no allowance left it writes nothing, so the caller can price it normally', async () => {
        await setAllowance(1, 100);
        const u = await user();
        await submit(u, 'fb-1');
        assert.deepEqual(await submit(u, 'fb-2'), { ok: true, taken: false, code: 'ALLOWANCE_USED' });
        assert.equal((await one('SELECT count(*)::int AS n FROM public.jobs WHERE user_id = $1', [u])).n, 1);
        await setAllowance(0, 0);
        assert.equal((await submit(u, 'fb-3')).code, 'NO_ALLOWANCE');
    });

    await check('a failed free job gives the allowance back through ledger_refund, once, with no ledger row', async () => {
        await setAllowance(1, 100);
        const u = await user(); const before = await balance(u);
        const { job_id } = await submit(u, 'rf-1');
        assert.equal((await submit(u, 'rf-2')).code, 'ALLOWANCE_USED');
        const first = await refund(job_id, u, 0);
        assert.deepEqual([first.ok, first.allowance_returned, first.idempotent], [true, true, false], JSON.stringify(first));
        assert.equal((await one('SELECT state FROM public.jobs WHERE id = $1', [job_id])).state, 'REFUNDED');
        assert.equal(await claim(u, 'rf-1'), 'RETURNED');
        assert.equal(await ledgerRows(job_id), 0);
        assert.deepEqual(await balance(u), before);
        const second = await refund(job_id, u, 0);
        assert.deepEqual([second.ok, second.idempotent], [true, true]);
        assert.equal((await submit(u, 'rf-2')).taken, true, 'the allowance is usable again');
    });

    await check('the stuck-job sweeper clears a free job and returns its allowance', async () => {
        await setAllowance(1, 100);
        const u = await user();
        const { job_id } = await submit(u, 'sw-1');
        await pool.query(`UPDATE public.jobs SET updated_at = now() - interval '3 hours' WHERE id = $1`, [job_id]);
        assert.equal((await one('SELECT public.sweep_stuck_jobs() AS r')).r.ok, true);
        assert.equal((await one('SELECT state FROM public.jobs WHERE id = $1', [job_id])).state, 'REFUNDED');
        assert.equal(await claim(u, 'sw-1'), 'RETURNED');
    });

    await check('a finished free job keeps its allowance spent', async () => {
        const u = await user();
        const { job_id } = await submit(u, 'ok-1');
        await pool.query(`UPDATE public.jobs SET state = 'STORED' WHERE id = $1`, [job_id]);
        assert.deepEqual(await refund(job_id, u, 0), { ok: false, code: 'JOB_SUCCEEDED' });
        assert.equal(await claim(u, 'ok-1'), 'TAKEN');
    });

    await check('refund guards hold: paid refuses 0, free refuses more than 0, nulls and negatives invalid', async () => {
        const u = await user();
        const paid = (await one(`SELECT public.ledger_debit($1, $2, 2, 'debit:generation', 'seedance-2.0-fast', '{}'::jsonb) AS r`, [u, randomUUID()])).r;
        assert.equal(paid.ok, true, JSON.stringify(paid));
        assert.equal((await refund(paid.job_id, u, 0)).code, 'INVALID_CREDITS');
        const free = await submit(u, 'g-1');
        assert.equal((await refund(free.job_id, u, 1)).code, 'REFUND_EXCEEDS_DEBIT');
        assert.equal((await refund(free.job_id, u, -1)).code, 'INVALID_CREDITS');
        assert.equal((await one('SELECT public.ledger_refund($1, $2, NULL, $3) AS r', [free.job_id, u, 'refund:x'])).r.code, 'INVALID_CREDITS');
        assert.equal((await refund(free.job_id, randomUUID(), 0)).code, 'USER_MISMATCH');
    });

    await check('a paid job still refunds exactly as before', async () => {
        const u = await user(); const before = await balance(u);
        const paid = (await one(`SELECT public.ledger_debit($1, $2, 3, 'debit:generation', 'seedance-2.0-fast', '{}'::jsonb) AS r`, [u, randomUUID()])).r;
        assert.equal((await balance(u)).balance, before.balance - 3);
        const r = await refund(paid.job_id, u, 3);
        assert.deepEqual([r.ok, r.idempotent], [true, false], JSON.stringify(r));
        assert.deepEqual(await balance(u), before);
        assert.equal(await ledgerRows(paid.job_id), 2);
        assert.equal((await refund(paid.job_id, u, 3)).idempotent, true);
    });

    await check('concurrent submits at the budget edge create exactly the budget in jobs', async () => {
        await setAllowance(5, 3);
        await pool.query('DELETE FROM public.model_free_allowance_claims WHERE model_id = $1', [MODEL]);
        const users = await Promise.all(Array.from({ length: 8 }, () => user()));
        const results = await Promise.all(users.map((u, i) => submit(u, `race-${i}`)));
        assert.equal(results.filter((r) => r.taken).length, 3, JSON.stringify(results));
        assert.equal(results.filter((r) => r.code === 'BUDGET_SPENT').length, 5);
    });

    await check('a Frozen account is refused and the generation rate limit applies', async () => {
        const f = await user();
        await pool.query('UPDATE public.users SET frozen_at = now() WHERE id = $1', [f]);
        assert.equal((await submit(f, 'fz-1')).code, 'ACCOUNT_FROZEN');
        const u = await user();
        await submit(u, 'rl-1');
        const limited = await submit(u, 'rl-2', 1);
        assert.equal(limited.code, 'RATE_LIMITED');
        assert.ok(limited.retry_after_seconds >= 1);
    });

    await check('an account without the signup grant is not eligible', async () => {
        const u = await user({ confirmed: false });
        assert.equal((await submit(u, 'uc-1')).code, 'NOT_ELIGIBLE');
    });

    await check('only a job that took an allowance may have 0 credits', async () => {
        const u = await user();
        await assert.rejects(pool.query(`INSERT INTO public.jobs (user_id, idempotency_key, model_id, credits, inputs, state)
            VALUES ($1, 'zero-1', 'seedance-2.0-fast', 0, '{}'::jsonb, 'DEBITED')`, [u]), { code: '23514' });
    });

    await check('the nightly reconcile command includes the allowance check and fails on drift', async () => {
        // The replay database has a pg_cron stub, so the migration's schedule block is a no-op here. Run the command
        // text it schedules, which is what cron executes, straight from the file.
        const cron = await readFile(new URL('../packages/db/schema/supabase/0207_reconcile_includes_free_allowance.sql', import.meta.url), 'utf8');
        await pool.query(cron); // applies cleanly, and again: idempotent
        const command = cron.slice(cron.indexOf('$cmd$') + 5, cron.lastIndexOf('$cmd$'));
        assert.match(command, /reconcile_free_allowance\(\)/);
        assert.match(command, /reconcile_subscription_credits\(\)/, 'the earlier checks are still there');
        // Two taken, then the cap lowered to one: over its cap, so the nightly command must raise on this check.
        await setAllowance(3, 100);
        const u = await user();
        await submit(u, 'cr-1'); await submit(u, 'cr-2');
        await setAllowance(1, 100);
        await assert.rejects(pool.query(command), /[1-9][0-9]* free-allowance problems/);
    });

    // The chat turn runs this same sequence (lib/chatTurn.js): submit_free_job, job_submitted, then chat_complete_turn,
    // and on failure ledger_refund with the job's own credits, which is 0.
    await pool.query(`INSERT INTO public.model_catalog
        (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
        VALUES ($1, 'Free allowance chat test', 'openrouter-chat', 'test/model', 'text', 1, 0.0020, 'per_generation', NULL, false, false)`, [CHAT]);

    await check('a free chat reply is stored at 0 credits with no ledger row and no balance change', async () => {
        await setChat(3, 100);
        const u = await user(); const before = await balance(u);
        const t = (await one('SELECT public.chat_create_thread($1, $2) AS r', [await authOf(u), CHAT])).r.thread.id;
        const free = (await one('SELECT public.submit_free_job($1, $2, $3, $4::jsonb) AS r', [u, 'chat-free-1', CHAT, JSON.stringify({ kind: 'chat', thread_id: t })])).r;
        assert.equal(free.taken, true, JSON.stringify(free));
        assert.equal((await one(`SELECT public.job_submitted($1, 'openrouter-chat', $2) AS r`, [free.job_id, String(free.job_id)])).r.ok, true);
        const done = (await one('SELECT public.chat_complete_turn($1, $2, $3, $4, $5) AS r', [free.job_id, t, 'hello', 'hi there', 'complete'])).r;
        assert.deepEqual([done.ok, done.refund], [true, false], JSON.stringify(done));
        assert.equal((await one('SELECT state::text AS s FROM public.jobs WHERE id = $1', [free.job_id])).s, 'STORED');
        assert.equal(Number((await one(`SELECT credits FROM public.chat_messages WHERE job_id = $1 AND role = 'assistant'`, [free.job_id])).credits), 0);
        assert.equal(await ledgerRows(free.job_id), 0);
        assert.deepEqual(await balance(u), before);
        assert.equal(await claim(u, 'chat-free-1'), 'TAKEN');
    });

    await check('a failed free chat reply returns the allowance and charges nothing', async () => {
        await setChat(3, 100);
        const u = await user(); const before = await balance(u);
        const t = (await one('SELECT public.chat_create_thread($1, $2) AS r', [await authOf(u), CHAT])).r.thread.id;
        const free = (await one('SELECT public.submit_free_job($1, $2, $3, $4::jsonb) AS r', [u, 'chat-free-2', CHAT, JSON.stringify({ kind: 'chat', thread_id: t })])).r;
        assert.equal((await one(`SELECT public.job_submitted($1, 'openrouter-chat', $2) AS r`, [free.job_id, String(free.job_id)])).r.ok, true);
        const cut = (await one('SELECT public.chat_complete_turn($1, $2, $3, $4, $5) AS r', [free.job_id, t, 'hello', 'partial', 'error'])).r;
        assert.equal(cut.ok, true, JSON.stringify(cut));
        assert.equal(cut.refund, true);
        assert.equal(Number(cut.credits), 0, 'the turn hands back the job\'s own credits, which are 0');
        const back = await refund(free.job_id, u, Number(cut.credits));
        assert.deepEqual([back.ok, back.allowance_returned], [true, true], JSON.stringify(back));
        assert.equal(await claim(u, 'chat-free-2'), 'RETURNED');
        assert.equal(await ledgerRows(free.job_id), 0);
        assert.deepEqual(await balance(u), before);
    });

    await check('submit_free_job is service-role only', async () => {
        const sig = 'public.submit_free_job(uuid,text,text,jsonb,integer,integer)';
        assert.deepEqual(await one(`SELECT has_function_privilege('anon', '${sig}', 'EXECUTE') AS anon,
            has_function_privilege('authenticated', '${sig}', 'EXECUTE') AS auth,
            has_function_privilege('service_role', '${sig}', 'EXECUTE') AS svc`), { anon: false, auth: false, svc: true });
    });
} finally {
    await setAllowance(0, 0).catch(() => {});
    await setChat(0, 0).catch(() => {});
    await pool.query('UPDATE public.model_catalog SET active = false WHERE id = $1', [CHAT]).catch(() => {});
    // Leave no drift behind for the scripts that run after this one.
    await pool.query('DELETE FROM public.model_free_allowance_claims WHERE model_id = ANY($1::text[])', [[MODEL, CHAT]]).catch(() => {});
    await pool.query('UPDATE public.model_catalog SET active = false WHERE id = $1', [MODEL]).catch(() => {});
    await pool.end();
}
if (failed > 0) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('free-allowance jobs: all passed');
