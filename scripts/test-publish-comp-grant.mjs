// Run only against a disposable local database replayed through 0424.
// The migration is re-applied inside a transaction that is rolled back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)) throw Error('isolated local replay database required');
const { default: pg } = await import('pg');
const c = new pg.Client({ connectionString: url });
await c.connect();
const scalar = async (sql, args = []) => (await c.query(sql, args)).rows[0]?.r;
const REASON = 'Owner approved a 14-day Publish Plan for the QA test account (fixture).';
try {
    await c.query('BEGIN');
    const migration = (await readFile(new URL('../packages/db/schema/supabase/0423_publish_plan_comp_grant.sql', import.meta.url), 'utf8'))
        .replace(/^BEGIN;\n/m, '').replace(/^COMMIT;\n?$/m, '');
    await c.query(migration); await c.query(migration);
    // 0423 re-applied its own function bodies; 0424 puts the lapse handling back on top of them.
    const lapse = (await readFile(new URL('../packages/db/schema/supabase/0424_end_lapsed_publish_comps.sql', import.meta.url), 'utf8'))
        .replace(/^BEGIN;\n/m, '').replace(/^COMMIT;\n?$/m, '');
    await c.query(lapse); await c.query(lapse);
    const auth = randomUUID(), other = randomUUID();
    for (const id of [auth, other]) await c.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, `${id}@example.invalid`]);
    const grant = (id, plan, key, days, reason) => scalar('SELECT public.grant_social_publish_comp($1,$2,$3,$4,$5) AS r', [id, plan, key, days, reason]);
    const entitlement = id => scalar('SELECT public.read_social_publish_entitlement($1) AS r', [id]);

    assert.equal((await entitlement(auth)).tier, 'free');
    assert.equal((await grant(auth, 'publish-weekly', 'qa-comp-key-1', 15, REASON)).code, 'BAD_DAYS');
    assert.equal((await grant(auth, 'publish-weekly', 'qa-comp-key-1', 0, REASON)).code, 'BAD_DAYS');
    assert.equal((await grant(auth, 'publish-weekly', 'qa-comp-key-1', 7, 'too short')).code, 'REASON_REQUIRED');
    assert.equal((await grant(auth, 'publish-weekly', 'short', 7, REASON)).code, 'IDEMPOTENCY_KEY_REQUIRED');
    assert.equal((await grant(auth, 'no-such-plan', 'qa-comp-key-1', 7, REASON)).code, 'PLAN_NOT_FOUND');
    assert.equal((await grant(randomUUID(), 'publish-weekly', 'qa-comp-key-1', 7, REASON)).code, 'USER_NOT_FOUND');
    assert.equal((await entitlement(auth)).tier, 'free', 'a refused grant changes nothing');

    const first = await grant(auth, 'publish-weekly', 'qa-comp-key-1', 7, REASON);
    assert.equal(first.ok, true);
    assert.equal(first.idempotent, false);
    const paid = await entitlement(auth);
    assert.equal(paid.tier, 'publish');
    assert.equal(paid.subscription.cancel_at_period_end, true);

    const replay = await grant(auth, 'publish-weekly', 'qa-comp-key-1', 7, REASON);
    assert.equal(replay.idempotent, true);
    assert.equal(replay.subscription_id, first.subscription_id);
    // Every changed argument on a replay is refused, including a null plan.
    assert.equal((await grant(auth, 'publish-monthly', 'qa-comp-key-1', 7, REASON)).code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal((await grant(auth, null, 'qa-comp-key-1', 7, REASON)).code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal((await grant(auth, 'publish-weekly', 'qa-comp-key-1', 14, REASON)).code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal((await grant(auth, 'publish-weekly', 'qa-comp-key-1', 7, REASON + ' (changed)')).code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(paid.subscription.complimentary, true, 'the entitlement says it is a comp and never carries the reason');
    assert.equal(JSON.stringify(paid).includes('Owner approved'), false);
    assert.equal((await grant(auth, 'publish-weekly', 'qa-comp-key-2', 7, REASON)).code, 'SUBSCRIPTION_ALREADY_ACTIVE');
    assert.equal(await scalar("SELECT count(*)::int AS r FROM public.social_publish_subscription_events WHERE type='publish.admin_comp'"), 1);

    await c.query("UPDATE public.social_publish_subscriptions SET current_period_end = now() - interval '1 minute' WHERE id = $1", [first.subscription_id]);
    assert.equal((await entitlement(auth)).tier, 'free', 'the grant lapses by itself');

    // The same key for a second account, and a look-alike key, both grant: the audit id comes from the row.
    const second = await grant(other, 'publish-weekly', 'qa-comp-key-1', 7, REASON);
    assert.equal(second.ok, true);
    await c.query("UPDATE public.social_publish_subscriptions SET status='ended', ended_at=now(), end_reason='cancelled' WHERE id=$1", [second.subscription_id]);
    assert.equal((await grant(other, 'publish-weekly', 'qa.comp.key.1', 7, REASON)).ok, true);
    await c.query("UPDATE public.social_publish_subscriptions SET status='ended', ended_at=now(), end_reason='cancelled' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)", [other]);

    // 0424: a lapsed comp no longer blocks a paid start or flags the paid event.
    const lapsedUser = randomUUID();
    await c.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [lapsedUser, `${lapsedUser}@example.invalid`]);
    const lapsedComp = await grant(lapsedUser, 'publish-weekly', 'qa-comp-key-4', 7, REASON);
    assert.equal(lapsedComp.ok, true);
    const startPaid = key => scalar('SELECT public.start_social_publish_subscription($1,$2,$3,$4,$5,$6) AS r', [lapsedUser, 'publish-weekly', key, 'consent-v1', 10, 3600]);
    assert.equal((await startPaid('qa-start-key-1')).code, 'SUBSCRIPTION_ALREADY_ACTIVE', 'a live comp still blocks a paid start');
    await c.query("UPDATE public.social_publish_subscriptions SET current_period_end = now() - interval '1 minute' WHERE id = $1", [lapsedComp.subscription_id]);
    const started = await startPaid('qa-start-key-1');
    assert.equal(started.ok, true, 'a lapsed comp no longer blocks a paid start');
    assert.equal(await scalar('SELECT status AS r FROM public.social_publish_subscriptions WHERE id=$1', [lapsedComp.subscription_id]), 'ended');
    const activated = await scalar("SELECT public.apply_social_publish_subscription_event($1,$2,$3,$4,$5,$6,$7,$8,$9) AS r",
        ['evt_qa_1', 'customer.subscription.updated', started.subscription_id, 'sub_qaone', 'cus_qaone', 'active', new Date(Date.now() + 7 * 864e5), false, new Date()]);
    assert.equal(activated.status, 'active');
    assert.equal(activated.flagged, false, 'the paid row is not flagged by a lapsed comp');
    assert.equal((await entitlement(lapsedUser)).tier, 'publish');
    assert.equal((await entitlement(lapsedUser)).subscription.complimentary, false, 'a paid plan is not complimentary');

    const otherUser = await scalar('SELECT id AS r FROM public.users WHERE auth_id=$1', [other]);
    await c.query('SELECT public.freeze_account($1,$2,NULL)', [otherUser, 'comp grant fixture']);
    assert.equal((await grant(other, 'publish-weekly', 'qa-comp-key-3', 7, REASON)).code, 'ACCOUNT_FROZEN');

    for (const role of ['anon', 'authenticated']) {
        assert.equal(await scalar("SELECT has_function_privilege($1, 'public.grant_social_publish_comp(text,text,text,integer,text)', 'EXECUTE') AS r", [role]), false);
    }
    assert.equal(await scalar("SELECT has_function_privilege('service_role', 'public.grant_social_publish_comp(text,text,text,integer,text)', 'EXECUTE') AS r"), true);
    console.log('publish comp grant: all assertions passed');
} finally {
    await c.query('ROLLBACK');
    await c.end();
}
