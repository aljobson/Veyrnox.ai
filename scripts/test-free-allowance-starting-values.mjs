#!/usr/bin/env node
// Forward repair 0262: real catalog preconditions, repeatability and atomic refusal.
// Only a local rebuilt database is accepted, and all changes are rolled back.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw Error('DATABASE_URL must name a local throwaway PostgreSQL database');
}
const db = new pg.Client({ connectionString: url.href });
const original = await readFile(new URL('../packages/db/schema/supabase/0222_free_allowance_starting_values.sql', import.meta.url), 'utf8');
const repair = await readFile(new URL('../packages/db/schema/supabase/0262_free_allowance_replay_safe_starting_values.sql', import.meta.url), 'utf8');
const ids = ['chat-mistral-small', 'nano-banana-kie'];
const state = async () => (await db.query(`SELECT id, free_allowance_per_day AS per_account,
    free_allowance_daily_budget AS global_jobs FROM public.model_catalog WHERE id = ANY($1) ORDER BY id`, [ids])).rows;
const expected = [
    { id: ids[0], per_account: 3, global_jobs: 100 },
    { id: ids[1], per_account: 3, global_jobs: 40 },
];
let passed = 0;
async function check(name, fn) {
    await db.query('SAVEPOINT test_case');
    try { await fn(); passed++; console.log('  ok  ' + name); }
    finally { await db.query('ROLLBACK TO test_case'); }
}
async function refuses(sql, message) {
    await db.query('SAVEPOINT refused_call');
    await assert.rejects(db.query(sql), message);
    await db.query('ROLLBACK TO refused_call');
}
await db.connect();
try {
    await db.query('BEGIN');
    await check('0222 rejects its own already-applied target; 0262 repeats without changing it', async () => {
        assert.deepEqual(await state(), expected);
        await refuses(original, /Expected one chat-mistral-small row, updated 0/);
        await db.query(repair);
        await db.query(repair);
        assert.deepEqual(await state(), expected);
    });
    await check('zero starting values reach the identical intended allowances', async () => {
        await db.query('UPDATE public.model_catalog SET free_allowance_per_day=0, free_allowance_daily_budget=0 WHERE id=ANY($1)', [ids]);
        await db.query(repair);
        assert.deepEqual(await state(), expected);
    });
    await check('changed price and inactive catalog prerequisites remain refused', async () => {
        await db.query("UPDATE public.model_catalog SET credits_5s=3 WHERE id='chat-mistral-small'");
        await refuses(repair, /Expected one chat-mistral-small row, updated 0/);
        await db.query("UPDATE public.model_catalog SET credits_5s=1, active=false WHERE id='chat-mistral-small'");
        await refuses(repair, /Expected one chat-mistral-small row, updated 0/);
    });
    await check('a failed second cost check rolls back the first allowance assignment', async () => {
        await db.query("UPDATE public.model_catalog SET free_allowance_per_day=0, free_allowance_daily_budget=0 WHERE id='chat-mistral-small'");
        await db.query("UPDATE public.model_catalog SET provider_cost_per_unit=0.0210 WHERE id='nano-banana-kie'");
        const before = await state();
        await refuses(repair, /Expected one nano-banana-kie row, updated 0/);
        assert.deepEqual(await state(), before);
    });
    await check('allowance repair writes no credit ledger entries', async () => {
        const count = async () => (await db.query('SELECT count(*)::integer AS n FROM public.ledger_entries')).rows[0].n;
        const before = await count();
        await db.query(repair);
        assert.equal(await count(), before);
        for (const fn of ['reconcile_balances', 'reconcile_free_credits', 'reconcile_top_ups',
            'reconcile_failed_refunds', 'reconcile_subscription_credits']) {
            assert.equal((await db.query('SELECT * FROM public.' + fn + '()')).rows.length, 0, fn);
        }
    });
    console.log('\n' + passed + ' checks passed');
} finally {
    await db.query('ROLLBACK').catch(() => {});
    await db.end();
}
