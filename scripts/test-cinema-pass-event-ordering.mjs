#!/usr/bin/env node
// Cinema Pass event ordering: local PostgreSQL only; every fixture rolls back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw Error('DATABASE_URL must name a local throwaway PostgreSQL database');
}
const db = new pg.Client({ connectionString: url.href });
const original = await readFile(new URL('../packages/db/schema/supabase/0143_cinema_passes.sql', import.meta.url), 'utf8');
const originalFunction = original.slice(original.indexOf('CREATE OR REPLACE FUNCTION public.apply_cinema_pass_event('),
    original.indexOf('-- ── end_cinema_pass:'));
// Keep the migration body inside this script's outer rollback-only transaction.
const repair = (await readFile(new URL('../packages/db/schema/supabase/0263_cinema_pass_incomplete_event_guard.sql', import.meta.url), 'utf8'))
    .replace(/^BEGIN;\n/m, '').replace(/^COMMIT;\n?$/m, '');
const signature = 'public.apply_cinema_pass_event(text,text,uuid,text,text,text,timestamptz,boolean,timestamptz)';
const at = new Date(Math.floor((Date.now() - 60000) / 1000) * 1000).toISOString();
const later = new Date(Date.parse(at) + 1000).toISOString();
const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const value = async (sql, args = []) => (await q(sql, args))[0].value;
const eventId = () => 'evt_' + randomUUID().replaceAll('-', '');
const start = (actor) => value("SELECT public.start_cinema_pass($1,'pass-monthly',$2,'cinema-pass-2026-09-26',100,60) AS value", [actor, randomUUID()]);
const apply = (passId, sub, status, options = {}) => value(
    'SELECT public.apply_cinema_pass_event($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',
    [options.event ?? eventId(), options.type ?? 'customer.subscription.updated', passId, sub,
        options.customer ?? 'cus_ordering', status, options.periodEnd ?? periodEnd,
        options.cancel ?? false, options.at ?? at]);
const row = (id) => value('SELECT to_jsonb(p) AS value FROM public.cinema_passes p WHERE id=$1', [id]);
const countEvents = () => value('SELECT count(*)::integer AS value FROM public.cinema_pass_events');
const money = async () => ({
    entries: await value('SELECT count(*)::integer AS value FROM public.ledger_entries'),
    balances: await q('SELECT user_id,balance,free_balance FROM public.credit_balances ORDER BY user_id'),
});
async function person() {
    const actor = randomUUID();
    await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [actor, actor + '@example.invalid']);
    return actor;
}
let passed = 0;
async function check(name, fn) {
    await db.query('SAVEPOINT test_case');
    try { await fn(); passed++; console.log('  ok  ' + name); }
    finally { await db.query('ROLLBACK TO test_case'); }
}
await db.connect();
try {
    await db.query('BEGIN');
    await check('0143 reproduces the same-second paid-access regression', async () => {
        await db.query(originalFunction);
        const pass = await start(await person());
        assert.equal(pass.ok, true);
        assert.equal((await apply(pass.pass_id, 'sub_original_ordering', 'active')).status, 'active');
        const result = await apply(pass.pass_id, 'sub_original_ordering', 'incomplete');
        assert.deepEqual([result.status, result.stale], ['pending', false]);
    });
    await db.query(repair);
    await db.query(repair);
    await check('active and past_due survive same-second and later incomplete events unchanged', async () => {
        for (const status of ['active', 'past_due']) {
            for (const occurredAt of [at, later]) {
                const pass = await start(await person());
                const sub = 'sub_' + randomUUID().replaceAll('-', '');
                assert.equal((await apply(pass.pass_id, sub, status)).status, status);
                const before = await row(pass.pass_id), eventCount = await countEvents();
                const id = eventId();
                const stale = await apply(pass.pass_id, sub, 'incomplete', {
                    event: id, at: occurredAt, customer: 'cus_wrong_old_snapshot',
                    periodEnd: new Date(Date.parse(periodEnd) - 86400000).toISOString(), cancel: true,
                });
                assert.deepEqual([stale.ok, stale.status, stale.stale], [true, status, true]);
                assert.deepEqual(await row(pass.pass_id), before);
                assert.equal(await countEvents(), eventCount + 1, 'retain the immutable stale receipt');
                assert.equal((await q('SELECT status FROM public.cinema_pass_events WHERE stripe_event_id=$1', [id]))[0].status, 'incomplete');
                assert.equal((await apply(null, sub, 'incomplete', { event: id, at: occurredAt })).idempotent, true);
                assert.equal(await countEvents(), eventCount + 1, 'replay writes no second receipt');
            }
        }
    });
    await check('initial incomplete can activate in the same second and still blocks a second checkout', async () => {
        const actor = await person(), pass = await start(actor);
        assert.equal((await apply(pass.pass_id, 'sub_initial_ordering', 'incomplete')).status, 'pending');
        const active = await apply(pass.pass_id, 'sub_initial_ordering', 'active');
        assert.deepEqual([active.status, active.stale], ['active', false]);
        await apply(pass.pass_id, 'sub_initial_ordering', 'incomplete');
        assert.equal((await start(actor)).code, 'PASS_ALREADY_ACTIVE');
    });
    await check('renewals and past_due updates apply; ended and flagged remain terminal', async () => {
        const actor = await person(), first = await start(actor), second = await start(actor);
        await apply(first.pass_id, 'sub_terminal_first', 'active');
        assert.equal((await apply(first.pass_id, 'sub_terminal_first', 'past_due', { at: later })).status, 'past_due');
        const renewedEnd = new Date(Date.parse(periodEnd) + 86400000).toISOString();
        assert.equal((await apply(first.pass_id, 'sub_terminal_first', 'active', { at: later, periodEnd: renewedEnd })).stale, false);
        assert.equal(Date.parse((await row(first.pass_id)).current_period_end), Date.parse(renewedEnd));
        const duplicate = await apply(second.pass_id, 'sub_terminal_second', 'active', { at: later });
        assert.deepEqual([duplicate.status, duplicate.flagged], ['flagged', true]);
        const flagged = await row(second.pass_id);
        assert.equal((await apply(null, 'sub_terminal_second', 'incomplete', { at: later })).stale, true);
        assert.deepEqual(await row(second.pass_id), flagged);
        await apply(first.pass_id, 'sub_terminal_first', 'ended', { at: later });
        const ended = await row(first.pass_id);
        assert.equal((await apply(null, 'sub_terminal_first', 'active', { at: later })).stale, true);
        assert.deepEqual(await row(first.pass_id), ended);
    });
    await check('binding mismatch and older events remain refused or stale', async () => {
        const pass = await start(await person());
        await apply(pass.pass_id, 'sub_binding_ordering', 'active');
        assert.equal((await apply(randomUUID(), 'sub_binding_ordering', 'active')).code, 'PASS_MISMATCH');
        assert.equal((await apply(pass.pass_id, 'sub_unbound_ordering', 'active')).code, 'PASS_NOT_FOUND');
        const before = await row(pass.pass_id);
        assert.equal((await apply(null, 'sub_binding_ordering', 'ended', { at: new Date(Date.parse(at) - 1000).toISOString() })).stale, true);
        assert.deepEqual(await row(pass.pass_id), before);
    });
    await check('Pass lifecycle and stale receipts never change credit ledger or balances', async () => {
        const actor = await person(), before = await money(), pass = await start(actor);
        await apply(pass.pass_id, 'sub_money_ordering', 'active');
        await apply(pass.pass_id, 'sub_money_ordering', 'incomplete');
        await apply(pass.pass_id, 'sub_money_ordering', 'past_due', { at: later });
        await apply(pass.pass_id, 'sub_money_ordering', 'ended', { at: later });
        assert.deepEqual(await money(), before);
    });
    await check('event writer remains a service-only security definer with empty search_path', async () => {
        const privileges = await q(`SELECT role, has_function_privilege(role, $1, 'EXECUTE') AS execute
            FROM unnest(ARRAY['anon','authenticated','service_role']) AS role`, [signature]);
        assert.deepEqual(privileges, [{ role: 'anon', execute: false }, { role: 'authenticated', execute: false }, { role: 'service_role', execute: true }]);
        const fn = (await q('SELECT prosecdef,proconfig FROM pg_proc WHERE oid=$1::regprocedure', [signature]))[0];
        assert.equal(fn.prosecdef, true);
        assert.ok(fn.proconfig.includes('search_path=""'));
    });
    console.log('\n' + passed + ' checks passed');
} finally {
    await db.query('ROLLBACK').catch(() => {});
    await db.end();
}
