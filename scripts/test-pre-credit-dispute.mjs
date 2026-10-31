#!/usr/bin/env node
// A dispute that arrives before its Top-up is credited is persisted by
// PaymentIntent and applied when the credit lands: the account is Frozen and
// the pending row is consumed (assessment F-06, ADR-0307). Runs on the full
// replayed chain; throwaway LOCAL database only, everything rolls back.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must identify a throwaway local test database');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname)) {
    throw new Error('refuses remote databases and non-test database names');
}
const db = new pg.Client({ connectionString });
await db.connect();
let passed = 0;
const check = async (name, run) => { await run(); passed++; console.log(`ok ${passed} - ${name}`); };
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const val = async (sql, args = []) => Object.values(await one(sql, args))[0];

const CREDITS = 300, PRICE = 2500;
const frozen = (userId) => val('SELECT frozen_at IS NOT NULL FROM public.users WHERE id = $1', [userId]);
const balance = (userId) => val('SELECT balance FROM public.credit_balances WHERE user_id = $1', [userId]);
const pendingRows = (order) => val('SELECT count(*)::int FROM public.top_up_pending_disputes WHERE order_id = $1', [order]);
const freezeActions = (userId) => val(
    "SELECT count(*)::int FROM public.account_actions WHERE user_id = $1 AND action = 'freeze'", [userId]);

/** A signed-up user with a PENDING (not yet credited) 300-credit Top-up. */
async function pendingTopUp() {
    const authId = randomUUID();
    const userId = await val('SELECT public.signup_grant($1, $2)', [authId, `${randomUUID()}@test.veyrnox.ai`]);
    const packId = `test-${randomUUID().slice(0, 8)}`;
    await db.query(`INSERT INTO public.credit_packs (id, sales_channel, credits, price_usd_cents, active) VALUES ($1, 'web', $2, $3, true)`, [packId, CREDITS, PRICE]);
    const pending = await val(`SELECT public.create_pending_top_up($1, $2, $3, '2026-09-13', 10, 600)`, [authId, packId, `test-${randomUUID()}`]);
    return { userId, topUpId: pending.top_up_id, order: `pi_${randomInt(1e9, 2e9)}` };
}
const disputeEvent = (order, ref) => val(`SELECT public.apply_dispute_event($1, 'created', $2)`, [order, ref]);
const note = (order, ref) => val('SELECT public.note_top_up_dispute($1, $2)', [order, ref]);
const credit = (topUpId, order) => val(`SELECT public.credit_top_up($1, $2, $3, 'USD', NULL)`, [topUpId, order, PRICE]);

try {
    await db.query('BEGIN');

    await check('dispute before credit: TOP_UP_NOT_FOUND, then the credit Freezes and consumes the pending row', async () => {
        const t = await pendingTopUp();
        const before = await balance(t.userId);
        // The dispute arrives first. No credited Top-up claims this PaymentIntent yet.
        const d = await disputeEvent(t.order, 'dp_ref_1');
        assert.equal(d.ok, false); assert.equal(d.code, 'TOP_UP_NOT_FOUND');
        // The webhook persists it by PaymentIntent.
        assert.deepEqual(await note(t.order, 'dp_ref_1'), { ok: true });
        assert.equal(await pendingRows(t.order), 1);
        assert.equal(await frozen(t.userId), false, 'not frozen before the credit lands');
        // The delayed payment credits. The persisted dispute is applied atomically.
        const c = await credit(t.topUpId, t.order);
        assert.equal(c.ok, true, JSON.stringify(c));
        assert.equal(c.disputed, true, 'the credit reports it applied the pending dispute');
        assert.equal(await balance(t.userId), before + CREDITS, 'credits were granted');
        assert.equal(await frozen(t.userId), true, 'the account is Frozen on the pre-credit dispute');
        assert.equal(await freezeActions(t.userId), 1, 'one freeze recorded in account_actions');
        assert.equal(await pendingRows(t.order), 0, 'the pending dispute row is consumed');
    });

    await check('a credit with no pending dispute is not frozen', async () => {
        const t = await pendingTopUp();
        const c = await credit(t.topUpId, t.order);
        assert.equal(c.ok, true, JSON.stringify(c));
        assert.equal(c.disputed, false);
        assert.equal(await frozen(t.userId), false);
        assert.equal(await freezeActions(t.userId), 0);
    });

    await check('note_top_up_dispute refuses an already-credited order and an invalid id', async () => {
        const t = await pendingTopUp();
        await credit(t.topUpId, t.order);
        assert.deepEqual(await note(t.order, 'late'), { ok: false, code: 'ALREADY_CREDITED' });
        assert.deepEqual(await note('bad id!', 'x'), { ok: false, code: 'INVALID_ORDER_ID' });
    });

    await check('a replay of the credit after a dispute stays Frozen and grants once', async () => {
        const t = await pendingTopUp();
        await note(t.order, 'dp_ref_2');
        const first = await credit(t.topUpId, t.order);
        const after = await balance(t.userId);
        const again = await credit(t.topUpId, t.order);
        assert.equal(again.ok, true);
        assert.equal(again.idempotent, true, 'the replay is idempotent');
        assert.equal(await balance(t.userId), after, 'no second grant');
        assert.equal(await frozen(t.userId), true);
        assert.equal(first.disputed, true);
    });

    // grants: service_role may execute the new RPC, anon/authenticated may not.
    await check('note_top_up_dispute is service-role only', async () => {
        assert.equal(await val("SELECT has_function_privilege('service_role','public.note_top_up_dispute(text,text)','EXECUTE')"), true);
        assert.equal(await val("SELECT has_function_privilege('anon','public.note_top_up_dispute(text,text)','EXECUTE')"), false);
        assert.equal(await val("SELECT has_function_privilege('authenticated','public.note_top_up_dispute(text,text)','EXECUTE')"), false);
    });

    console.log(`pre-credit dispute persistence: ok (${passed})`);
} finally {
    await db.query('ROLLBACK').catch(() => {});
    await db.end();
}
