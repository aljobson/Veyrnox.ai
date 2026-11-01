// Run only against a disposable local database replayed through 0423.
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
    assert.equal((await grant(auth, 'publish-monthly', 'qa-comp-key-1', 7, REASON)).code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal((await grant(auth, 'publish-weekly', 'qa-comp-key-2', 7, REASON)).code, 'SUBSCRIPTION_ALREADY_ACTIVE');
    assert.equal(await scalar("SELECT count(*)::int AS r FROM public.social_publish_subscription_events WHERE type='publish.admin_comp'"), 1);

    await c.query("UPDATE public.social_publish_subscriptions SET current_period_end = now() - interval '1 minute' WHERE id = $1", [first.subscription_id]);
    assert.equal((await entitlement(auth)).tier, 'free', 'the grant lapses by itself');

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
