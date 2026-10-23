#!/usr/bin/env node
// 0347 (ADR-0111): a person deletes their own account. Runs against the full migration replay
// (ledger-tests.yml). Every fixture is rolled back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const call = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) AS r`, args)).r;

const signUp = async (email = `${randomUUID()}@test.veyrnox.ai`) => {
    const authId = randomUUID();
    await c.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [authId, email]);
    const user = await one('SELECT id FROM public.users WHERE auth_id = $1', [authId]);
    return { authId, userId: user.id, email };
};
const prepare = async (authId) => call('prepare_account_deletion', authId);
const token = async (authId) => {
    const r = await prepare(authId);
    assert.equal(r.eligible, true, `not eligible: ${JSON.stringify(r)}`);
    return r.confirmation_token;
};
const erase = (authId, t) => call('erase_account', authId, t);
const refusedAs = async (role, sql, args = []) => {
    await c.query('SAVEPOINT r');
    try { await c.query(`SET LOCAL ROLE ${role}`); await c.query(sql, args); assert.fail(`${role} was allowed: ${sql}`); }
    catch (err) { assert.equal(err.code, '42501', err.message); }
    finally { await c.query('ROLLBACK TO SAVEPOINT r'); }
};
const job = (userId, state, inputs = { prompt: 'a private prompt' }) =>
    one(`INSERT INTO public.jobs (user_id, idempotency_key, model_id, credits, state, inputs)
         VALUES ($1, $2, 'test-model', 3, $3::job_state, $4) RETURNING id`, [userId, randomUUID(), state, inputs]);

await c.query('BEGIN');
try {
    const migration = await readFile(new URL('../packages/db/schema/supabase/0347_account_deletion.sql', import.meta.url), 'utf8');
    await c.query('SAVEPOINT again'); await c.query(migration); await c.query(migration); await c.query('RELEASE SAVEPOINT again');

    // 1. Nobody else's account, nobody's guess.
    assert.equal((await prepare(randomUUID())).error, 'account_not_found');
    const alice = await signUp();
    const bob = await signUp();
    assert.equal((await call('daily_checkin', alice.authId)).ok, true);
    assert.equal((await erase(alice.authId, 'x')).error, 'confirmation_invalid', 'a malformed token');
    assert.equal((await erase(alice.authId, 'a'.repeat(64))).error, 'confirmation_invalid', 'an unknown token');
    const bobToken = await token(bob.authId);
    assert.equal((await erase(alice.authId, bobToken)).error, 'confirmation_invalid', "another account's token");
    assert.equal((await one('SELECT deleted_at FROM public.users WHERE id = $1', [bob.userId])).deleted_at, null, 'bob untouched');

    // 2. The erasure. Alice has a ledger, a stored file, a chat, a Publish brand with a live token.
    const spent = await call('ledger_debit', alice.userId, randomUUID(), 4, 'debit:generation', 'test-model', { prompt: 'x' });
    assert.equal(spent.ok, true, JSON.stringify(spent));
    await call('ledger_refund', spent.job_id, alice.userId, 4, 'refund:test');
    const stored = await job(alice.userId, 'STORED');
    const assetKey = `generations/${randomUUID()}.png`;
    await c.query(`INSERT INTO public.assets (job_id, r2_key, mime_type, size_bytes, sha256) VALUES ($1, $2, 'image/png', 10, $3)`,
        [stored.id, assetKey, 'a'.repeat(64)]);
    const thread = await one(`INSERT INTO public.chat_threads (user_id, model_id) VALUES ($1, 'test-model') RETURNING id`, [alice.userId]);
    await c.query(`INSERT INTO public.chat_messages (thread_id, role, content) VALUES ($1, 'user', 'hello')`, [thread.id]);
    const brand = await one(`INSERT INTO public.social_brands (owner_user_id, label) VALUES ($1, 'Alice Co') RETURNING id`, [alice.userId]);
    const account = await one(`INSERT INTO public.social_accounts (brand_id, network, external_account_id, access_token_enc, refresh_token_enc)
        VALUES ($1, 'twitter', 'ext-1', '\\x01', '\\x02') RETURNING id`, [brand.id]);
    await c.query(`INSERT INTO public.social_posts (brand_id, created_by_user_id, status, scheduled_at, global_text, idempotency_key, draft_batch_id)
        VALUES ($1, $2, 'scheduled', now() + interval '1 day', 'later', $3, NULL)`, [brand.id, alice.userId, `scheduled-${randomUUID()}`]);
    const reserve = `uploads/${randomUUID()}`;
    await c.query(`INSERT INTO public.upload_reservations (r2_key, user_id, size_bytes, put_expires_at) VALUES ($1, $2, 5, now() + interval '1 hour')`, [reserve, alice.userId]);
    const before = await one(`SELECT b.balance, b.free_balance, (SELECT count(*)::int FROM public.ledger_entries WHERE user_id = b.user_id) AS entries
        FROM public.credit_balances b WHERE b.user_id = $1`, [alice.userId]);

    const preview = await prepare(alice.authId);
    assert.equal(preview.eligible, true, JSON.stringify(preview));
    assert.deepEqual(preview.forfeit, { credits: before.balance, free_credits: before.free_balance });
    assert.match(preview.confirmation_token, /^[0-9a-f]{64}$/);
    const hashed = await one('SELECT token_hash FROM public.account_deletions WHERE user_id = $1', [alice.userId]);
    assert.notEqual(hashed.token_hash.toString('hex'), preview.confirmation_token, 'the token is stored hashed');

    const done = await erase(alice.authId, preview.confirmation_token);
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.equal(done.replayed, false);
    assert.equal(done.forfeited_credits, before.balance);

    const tomb = await one('SELECT email, auth_id, deleted_at FROM public.users WHERE id = $1', [alice.userId]);
    assert.ok(tomb.deleted_at);
    assert.equal(tomb.email, `deleted-${alice.userId}@erased.invalid`);
    assert.equal((await one('SELECT count(*)::int AS n FROM public.checkin_streaks WHERE user_id=$1', [alice.userId])).n, 0);
    assert.equal(tomb.auth_id, `erased:${alice.userId}`);
    assert.equal((await one('SELECT count(*)::int AS n FROM public.assets WHERE job_id = $1', [stored.id])).n, 0, 'asset row gone');
    for (const key of [assetKey, reserve]) {
        assert.equal((await one('SELECT count(*)::int AS n FROM public.asset_reap_queue WHERE r2_key = $1', [key])).n, 1, `${key} queued for the reaper`);
    }
    assert.deepEqual((await one('SELECT inputs FROM public.jobs WHERE id = $1', [stored.id])).inputs, {}, 'prompt scrubbed');
    assert.equal((await one('SELECT count(*)::int AS n FROM public.chat_threads WHERE user_id = $1', [alice.userId])).n, 0);
    assert.equal((await one('SELECT count(*)::int AS n FROM public.chat_messages WHERE thread_id = $1', [thread.id])).n, 0);
    const sa = await one('SELECT status, access_token_enc, refresh_token_enc, disconnected_at FROM public.social_accounts WHERE id = $1', [account.id]);
    assert.equal(sa.status, 'revoked'); assert.equal(sa.access_token_enc, null); assert.equal(sa.refresh_token_enc, null); assert.ok(sa.disconnected_at);
    assert.equal((await one('SELECT count(*)::int AS n FROM public.social_posts WHERE brand_id = $1', [brand.id])).n, 0, 'scheduled post removed');
    assert.equal((await one('SELECT label FROM public.social_brands WHERE id = $1', [brand.id])).label, 'Deleted brand');

    // 3. Money is exactly as it was: no ledger write, balance kept, every reconcile clean.
    const after = await one(`SELECT b.balance, b.free_balance, (SELECT count(*)::int FROM public.ledger_entries WHERE user_id = b.user_id) AS entries
        FROM public.credit_balances b WHERE b.user_id = $1`, [alice.userId]);
    assert.deepEqual(after, before);
    for (const fn of ['reconcile_balances', 'reconcile_free_credits', 'reconcile_top_ups', 'reconcile_subscription_credits']) {
        assert.equal((await q(`SELECT 1 FROM public.${fn}() WHERE user_id = $1`, [alice.userId])).length, 0, `${fn} clean`);
    }
    const record = await one('SELECT state, forfeited_balance, forfeited_free FROM public.account_deletions WHERE user_id = $1 AND state <> $2', [alice.userId, 'prepared']);
    assert.deepEqual(record, { state: 'erased', forfeited_balance: before.balance, forfeited_free: before.free_balance });

    // 4. Idempotent: the same token again is the first answer, at every stage. The old auth id finds nothing.
    assert.deepEqual(await erase(alice.authId, preview.confirmation_token), { ok: true, replayed: true, state: 'erased' });
    assert.equal((await call('complete_account_deletion', alice.authId, preview.confirmation_token)).ok, true);
    assert.equal((await call('complete_account_deletion', alice.authId, preview.confirmation_token)).ok, true);
    assert.deepEqual(await erase(alice.authId, preview.confirmation_token), { ok: true, replayed: true, state: 'completed' });
    assert.equal((await prepare(alice.authId)).error, 'account_not_found', 'a deleted account cannot start again');
    assert.equal((await call('complete_account_deletion', bob.authId, bobToken)).ok, false, 'complete needs an erased row');

    // 5. Deleting and signing up again with the same address is not a second Free Credit grant.
    const again = await signUp(alice.email.toUpperCase());
    assert.notEqual(again.userId, alice.userId);
    assert.equal((await one('SELECT balance FROM public.credit_balances WHERE user_id = $1', [again.userId])).balance, 0, 'no grant');
    assert.equal((await one(`SELECT count(*)::int AS n FROM public.ledger_entries WHERE user_id = $1 AND reason = 'grant:signup'`, [again.userId])).n, 0);
    assert.equal((await one(`SELECT balance FROM public.credit_balances WHERE user_id = $1`, [bob.userId])).balance, 10, 'a new address still gets its grant');

    // 6. Frozen: the account cannot delete its way out of a dispute, before or after it holds a token.
    const frozen = await signUp();
    const frozenToken = await token(frozen.authId);
    await call('freeze_account', frozen.userId, 'test freeze', null);
    const refused = await prepare(frozen.authId);
    assert.equal(refused.eligible, false);
    assert.deepEqual(refused.blockers, ['account_frozen']);
    assert.equal(refused.confirmation_token, undefined, 'no token for a blocked account');
    const late = await erase(frozen.authId, frozenToken);
    assert.equal(late.error, 'deletion_blocked');
    assert.deepEqual(late.blockers, ['account_frozen']);
    assert.equal((await one('SELECT deleted_at FROM public.users WHERE id = $1', [frozen.userId])).deleted_at, null);

    // 7. The other refusals, each leaving the account whole.
    const blocked = async (fixture, expected) => {
        const u = await signUp();
        const t = await token(u.authId);
        await fixture(u);
        const r = await prepare(u.authId);
        assert.equal(r.eligible, false, expected);
        assert.deepEqual(r.blockers, [expected]);
        const e = await erase(u.authId, t);
        assert.equal(e.error, 'deletion_blocked', expected);
        assert.equal((await one('SELECT deleted_at FROM public.users WHERE id = $1', [u.userId])).deleted_at, null, `${expected} left the account`);
    };
    await blocked((u) => job(u.userId, 'SUBMITTED'), 'generation_in_progress');
    await blocked(async (u) => {
        const j = await job(u.userId, 'STORED');
        await c.query(`INSERT INTO public.assets (job_id, r2_key, mime_type, size_bytes, sha256, held_at) VALUES ($1, $2, 'image/png', 1, $3, now())`,
            [j.id, `generations/${randomUUID()}.png`, 'b'.repeat(64)]);
    }, 'account_on_hold');
    await blocked((u) => c.query(
        `INSERT INTO public.credit_subscriptions (user_id, plan_id, idempotency_key, price_usd_cents, credits, consent_version, status, started_at, current_period_end)
         VALUES ($1, 'starter-monthly', $2, 1900, 270, 'v1', 'active', now(), now() + interval '30 days')`, [u.userId, `sub-${randomUUID()}`]), 'active_subscription');
    await blocked(async (u) => {
        const b = await one(`INSERT INTO public.social_brands (owner_user_id, label) VALUES ($1, 'Team') RETURNING id`, [u.userId]);
        const other = await signUp();
        await c.query(`INSERT INTO public.social_brand_members (brand_id, user_id, role, invited_by) VALUES ($1, $2, 'editor', $3)`, [b.id, other.userId, u.userId]);
    }, 'publish_team_present');

    // 8. A token is short-lived and rate limited.
    const slow = await signUp();
    const slowToken = await token(slow.authId);
    await c.query(`UPDATE public.account_deletions SET token_expires_at = now() - interval '1 second' WHERE user_id = $1`, [slow.userId]);
    assert.equal((await erase(slow.authId, slowToken)).error, 'confirmation_expired');
    for (let i = 0; i < 4; i++) await token(slow.authId);          // 5 in the hour
    const limited = await prepare(slow.authId);
    assert.equal(limited.error, 'rate_limited');
    assert.equal(limited.retry_after_seconds, 3600);

    // 9. Only the Worker may call any of it.
    for (const role of ['anon', 'authenticated']) {
        await refusedAs(role, 'SELECT public.prepare_account_deletion($1)', [bob.authId]);
        await refusedAs(role, 'SELECT public.erase_account($1, $2)', [bob.authId, bobToken]);
        await refusedAs(role, 'SELECT public.complete_account_deletion($1, $2)', [bob.authId, bobToken]);
        await refusedAs(role, 'SELECT public.signup_grant_base($1, $2)', [randomUUID(), 'x@test.veyrnox.ai']);
        await refusedAs(role, 'SELECT * FROM public.account_deletions');
        await refusedAs(role, 'SELECT private.account_deletion_blockers($1, $2)', [bob.userId, bob.authId]);
    }
    await refusedAs('service_role', 'SELECT * FROM public.account_deletions');
    await c.query('SAVEPOINT s'); await c.query('SET LOCAL ROLE service_role');
    assert.equal((await one(`SELECT public.prepare_account_deletion($1)->>'eligible' AS e`, [bob.authId])).e, 'true');
    await c.query('ROLLBACK TO SAVEPOINT s');

    // 10. Drift guard. Every foreign key to a person's row is classified here on purpose, so a new table
    // that points at users forces a decision about deleting it, keeping it, or refusing the account.
    const ERASED = new Set(['chat_threads', 'chat_folders', 'chat_personas', 'chat_closed_sends', 'cinema_profiles', 'cinema_memberships',
        'cinema_creator_applications', 'cinema_creator_follows', 'cinema_series_follows', 'cinema_saved_titles', 'cinema_retention_requests', 'cinema_watch_resume',
        'referral_codes', 'upload_reservations', 'social_uploads', 'film_library_masters', 'editor_library_renders',
        'social_brands', 'social_api_keys', 'social_webhook_endpoints', 'social_posts', 'jobs',
        'push_tokens', 'push_outbox', 'push_token_writes', 'user_blocks', 'creator_profiles', 'checkin_streaks']);
    const WITH_AUTH_USER = new Set(['organisation_members', 'workspace_members', 'project_members', 'api_requests', 'editor_requests',
        'social_connection_selections', 'social_oauth_states', 'film_studio_projects', 'film_studio_save_windows']);
    const REFUSED_UNTIL_CLEARED = new Set(['cinema_submissions', 'cinema_competitions', 'cinema_story_polls', 'credit_subscriptions',
        'social_publish_subscriptions', 'social_brand_members', 'social_brand_invitations']);
    const RETAINED = new Set([
        // money and its audit trail
        'credit_balances', 'ledger_entries', 'top_ups', 'top_up_flagged_orders', 'account_actions', 'referral_rewards', 'referrals',
        'store_customers', 'provider_spend_reservations', 'model_free_allowance_claims', 'account_deletions', 'privacy_export_requests',
        // safety and moderation records
        'content_appeals', 'content_reports', 'cinema_unlocks', 'cinema_passes', 'cinema_pass_plays', 'cinema_free_plays',
        'cinema_watch_sessions', 'cinema_audience_clock', 'cinema_share_actions', 'cinema_ranking_snapshots', 'cinema_ranking_decisions',
        // ids only: counters and actor columns inside brands the person owned or joined
        'asset_link_rate_limits', 'generation_attempt_rate_limits', 'job_read_rate_limits', 'upload_request_rate_limits', 'account_read_rate_limits',
        'top_up_checkout_rate_limits', 'top_up_read_rate_limits', 'top_up_return_rate_limits', 'cinema_unlock_rate_limits', 'social_post_write_rate_limits',
        'social_account_actions', 'social_team_events', 'social_inbox_threads', 'social_inbox_actions', 'social_inbox_notes', 'social_inbox_suggestions',
        'social_inbox_contact_profiles', 'social_inbox_workflows', 'social_approval_requests', 'social_approval_events', 'social_report_templates',
        'social_commerce_products', 'social_ad_campaigns', 'social_publish_autolists',
    ]);
    const known = new Set([...ERASED, ...WITH_AUTH_USER, ...REFUSED_UNTIL_CLEARED, ...RETAINED]);
    const refs = await q(`SELECT DISTINCT c.conrelid::regclass::text AS tbl FROM pg_constraint c
        WHERE c.contype = 'f' AND c.confrelid IN ('public.users'::regclass, 'auth.users'::regclass)`);
    const live = new Set(refs.map((r) => r.tbl.replace(/^(public|private)\./, '')));
    const unclassified = [...live].filter((t) => !known.has(t));
    assert.deepEqual(unclassified, [], `tables that reference users and are not classified for account deletion: ${unclassified.join(', ')}`);
    const stale = [...known].filter((t) => !live.has(t));
    assert.deepEqual(stale, [], `classified tables that no longer reference users: ${stale.join(', ')}`);

    console.log('account deletion: ok');
} finally {
    await c.query('ROLLBACK');
    await c.end();
}
