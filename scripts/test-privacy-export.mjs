#!/usr/bin/env node
// Disposable replay DB only. All ordinary fixtures roll back; the locking test owns a second DB.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { ledgerKind } from '../lib/ledgerKind.js';

const url = process.env.DATABASE_URL;
const serverUrl = process.env.PRIVACY_EXPORT_SERVER_URL || url;
for (const target of [url, serverUrl]) {
    if (!target || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(target).hostname)) throw Error('isolated local database required');
}
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const start = async (auth, aal = 'aal1') => (await one('SELECT public.start_privacy_export($1,$2) AS r', [auth, aal])).r;
const read = async (auth, id, section, cursor = null, size = null, thread = null, aal = 'aal1') =>
    (await one('SELECT public.read_privacy_export_page($1,$2,$3,$4,$5,$6,$7,$8) AS r', [auth, aal, id, section, thread, cursor?.after ?? null, cursor?.key ?? null, size])).r;
const ALLOW = {
    profile: 'id email created_at preferred_locale rights_attested_at rights_attestation_version balance free_balance subscription_balance subscription_expires_at cinema_profile cinema_membership referral_code referred_at referrals_made push_devices sanctions_hold_until frozen',
    credit_history: 'id delta free_delta subscription_delta job_id created_at reason',
    top_ups: 'id pack_id sales_channel credits price_usd_cents status consent_at consent_version created_at credited_at refunded_cents clawed_back_credits returned_at',
    credit_subscriptions: 'id plan_id status price_usd_cents consent_version consent_at started_at current_period_end cancel_at_period_end ended_at end_reason created_at credits',
    publish_subscriptions: 'id plan_id status price_usd_cents consent_version consent_at started_at current_period_end cancel_at_period_end ended_at end_reason created_at',
    creations: 'id model_id credits state error_code free_allowance consent_attested_at created_at updated_at kind prompt topic',
    chat_folders: 'id name created_at', chat_personas: 'id name instructions default_model_id thinking web created_at',
    chat_threads: 'id folder_id model_id title system_prompt pinned created_at updated_at',
    chat_messages: 'id thread_id seq role content model_id credits status created_at',
    publish_brands: 'id label timezone created_at',
    publish_connections: 'id brand_id network display_name status scopes_granted connected_at disconnected_at',
    publish_posts: 'id brand_id status scheduled_at global_text created_at',
    saved_titles: 'content_id created_at', series_follows: 'series_id created_at', creator_follows: 'creator_username',
    watch_progress: 'content_id position_seconds duration_seconds completed updated_at',
    votes: 'content_id competition_id status created_at', comments: 'id content_id body status created_at', blocks: 'blocked_username created_at',
    sanctions: 'action_id action created_at job_id model_id hold_until appeal_status appeal_submitted_at appeal_decided_at',
    appeals: 'action_id statement status submitted_at decided_at', reports: 'category subject_kind details status created_at resolved_at',
};
const keys = (row, names) => assert.deepEqual(Object.keys(row).sort(), names.split(' ').sort());
const secrets = ['op-note-secret', 'token-secret-bytes', 'stripe_secret', 'private-input-secret', 'provider-secret', 'teammate-secret', 'bob-private', 'velocity', 'decision-secret', 'operator-secret', 'external-secret', 'device-secret', 'version-secret', 'post-secret-key', 'idempotency-secret-credit', 'idempotency-secret-publish'];
const otherIds = [];
async function person(label, confirmed = true) {
    const auth = randomUUID(), email = `${label}-${randomUUID()}@example.invalid`;
    await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,$3)', [auth, email, confirmed ? new Date() : null]);
    const { id } = await one('SELECT id FROM public.users WHERE auth_id=$1', [auth]);
    const username = 'p_' + randomUUID().replaceAll('-', '').slice(0, 20), createKey = randomUUID();
    await q('INSERT INTO public.cinema_profiles(user_id,username,display_name,create_key) VALUES($1,$2,$3,$4)', [id, username, label, createKey]);
    await q("INSERT INTO public.cinema_memberships(user_id) VALUES($1) ON CONFLICT DO NOTHING", [id]);
    secrets.push(createKey);
    return { auth, id, username, email };
}
async function fixture(who, other) {
    const { id } = who, hidden = 'private-input-secret';
    await q("SELECT public.ledger_grant($1,3,'op-note-secret',$2)", [id, randomUUID()]);
    await q(`INSERT INTO public.jobs(user_id,idempotency_key,model_id,credits,state,inputs,provider_job_id)
        SELECT $1, gen_random_uuid()::text, 'test-model', 3, 'SUCCEEDED', $2::jsonb, 'provider-secret' FROM generate_series(1,201)`,
        [id, { prompt: who === other ? hidden : who.username, kind: 'image', topic: 'topic', private: hidden }]);
    const folder = await one("INSERT INTO public.chat_folders(user_id,name) VALUES($1,'folder') RETURNING id", [id]);
    await q("INSERT INTO public.chat_personas(user_id,name,instructions) VALUES($1,'persona','instructions')", [id]);
    const thread = await one("INSERT INTO public.chat_threads(user_id,model_id,title,folder_id) VALUES($1,'test-model',$2,$3) RETURNING id", [id, who.username, folder.id]);
    await q(`INSERT INTO public.chat_messages(thread_id,role,content) SELECT $1,'user',$2 FROM generate_series(1,51)`, [thread.id, who.username]);
    const pack = await one('SELECT id FROM public.credit_packs LIMIT 1');
    const top = await one(`INSERT INTO public.top_ups(user_id,pack_id,idempotency_key,sales_channel,credits,price_usd_cents,variant_id,consent_at,consent_version)
        VALUES($1,$2,'idempotency-secret-topup','web',3,300,'123',now(),'v1') RETURNING id`, [id, pack.id]);
    await q(`INSERT INTO public.top_ups(user_id,pack_id,idempotency_key,sales_channel,credits,price_usd_cents,variant_id,consent_at,consent_version)
        VALUES($1,$2,'idempotency-secret-topup-second','web',3,300,'123',now(),'v1')`, [id, pack.id]);
    secrets.push('idempotency-secret-topup');
    const creditPlan = await one('SELECT id FROM public.credit_subscription_plans LIMIT 1');
    await q(`INSERT INTO public.credit_subscriptions(user_id,plan_id,idempotency_key,credits,price_usd_cents,consent_version,stripe_customer_id)
        VALUES($1,$2,'idempotency-secret-credit',3,300,'v1','cus_stripe_secret')`, [id, creditPlan.id]);
    const publishPlan = await one('SELECT id FROM public.social_publish_plans LIMIT 1');
    await q(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,stripe_customer_id)
        VALUES($1,$2,'idempotency-secret-publish',300,'v1','cus_stripe_secret')`, [id, publishPlan.id]);
    const brand = await one('INSERT INTO public.social_brands(owner_user_id,label) VALUES($1,$2) RETURNING id', [id, who.username]);
    await q(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,access_token_enc,refresh_token_enc,display_name)
        VALUES($1,'youtube','external-secret',convert_to('token-secret-bytes','UTF8'),convert_to('token-secret-bytes','UTF8'),$2)`, [brand.id, who.username]);
    await q(`INSERT INTO public.social_posts(brand_id,created_by_user_id,scheduled_at,global_text,idempotency_key) VALUES($1,$2,now(),$3,'post-secret-key')`, [brand.id, id, who.username]);
    await q(`INSERT INTO public.social_posts(brand_id,created_by_user_id,scheduled_at,global_text,idempotency_key) VALUES($1,$2,now(),'teammate-secret','teammate-secret-key')`, [brand.id, other.id]);
    const content = await one(`INSERT INTO public.cinema_content(creator_id,content_type,title,language) VALUES($1,'FILM','public title','en') RETURNING id`, [id]);
    const series = await one(`INSERT INTO public.cinema_content(creator_id,content_type,title,language) VALUES($1,'SERIES','public series','en') RETURNING id`, [id]);
    await q('INSERT INTO public.cinema_saved_titles(user_id,content_id,created_at) VALUES($1,$2,now())', [id, content.id]);
    await q('INSERT INTO public.cinema_series_follows(user_id,series_id,created_at) VALUES($1,$2,now())', [id, series.id]);
    await q('INSERT INTO public.cinema_creator_follows(user_id,creator_id,created_at) VALUES($1,$2,now())', [id, other.id]);
    await q('INSERT INTO public.user_blocks(blocker_id,blocked_id) VALUES($1,$2)', [id, other.id]);
    for (const title of [content, series]) await q('INSERT INTO public.cinema_watch_resume(user_id,content_id,position_seconds,duration_seconds) VALUES($1,$2,5,60)', [id, title.id]);
    const competition = await one(`INSERT INTO public.cinema_competitions(name,starts_at,ends_at,target_types,created_by) VALUES('Test',now(),now()+interval '1 day',ARRAY['FILM'],$1) RETURNING id`, [id]);
    const voteKey = randomUUID(); secrets.push(voteKey);
    await q(`INSERT INTO public.cinema_votes(voter_id,content_id,competition_id,idempotency_key,status,risk_reason) VALUES($1,$2,$3,$4,'under_review','velocity')`, [id, content.id, competition.id, voteKey]);
    await q('INSERT INTO public.cinema_comments(author_id,content_id,body) VALUES($1,$2,$3)', [id, content.id, who.username]);
    const action = await one(`INSERT INTO public.account_actions(user_id,action,actor,reason) VALUES($1,'warning','operator-secret','op-note-secret') RETURNING id`, [id]);
    await q(`INSERT INTO public.content_appeals(user_id,action_id,statement,status,decided_at,decided_by,decision_reason)
        VALUES($1,$2,'My own appeal statement','rejected',now(),'operator-secret','decision-secret')`, [id, action.id]);
    await q(`INSERT INTO public.content_reports(reporter_id,subject_kind,category,details,status,resolved_at,resolved_by,resolution)
        VALUES($1,'other','other','My own report','resolved',now(),'operator-secret','decision-secret')`, [id]);
    await q(`INSERT INTO public.push_tokens(user_id,token,platform,device_id,app_version) VALUES($1,$2,'ios','device-secret','version-secret')`, [id, `ExpoPushToken[${randomUUID().replaceAll('-', '')}]`]);
    const push = await one('SELECT token FROM public.push_tokens WHERE user_id=$1', [id]); secrets.push(push.token);
    return { thread: thread.id, top: top.id, content: content.id };
}
async function walk(who, id, section, size = null, thread = null, cursor = null) {
    const rows = [], responses = [];
    do {
        const response = await read(who.auth, id, section, cursor, size, thread);
        assert.equal(response.ok, true, JSON.stringify(response));
        assert.ok(response.rows.length <= (section === 'chat_messages' ? 50 : 200));
        for (const row of response.rows) keys(row, ALLOW[section]);
        // The SQL-only ledger reason is mapped at the Worker boundary.
        if (section === 'credit_history') response.rows = response.rows.map(({ reason, ...r }) => ({ ...r, kind: ledgerKind(reason, r.delta) }));
        const serialized = JSON.stringify(response);
        for (const secret of [...secrets, ...otherIds]) assert.ok(!serialized.includes(secret), `${section} leaked ${secret}`);
        rows.push(...response.rows); responses.push(response); cursor = response.next;
        assert.ok(responses.length < 6000);
    } while (cursor);
    return rows;
}
async function reject(sql, args = [], code) {
    await q('SAVEPOINT refused');
    try { await assert.rejects(c.query(sql, args), err => code ? err.code === code : /append-only/.test(err.message)); }
    finally { await q('ROLLBACK TO SAVEPOINT refused'); }
}
await q('BEGIN');
try {
    await q('CREATE TABLE IF NOT EXISTS auth.mfa_factors(user_id uuid,factor_type text,status text)');
    const migration = await readFile(new URL('../packages/db/schema/supabase/0362_privacy_export.sql', import.meta.url), 'utf8');
    await q(migration); await q(migration);
    await q('ALTER TABLE public.chat_messages ALTER COLUMN seq RESTART WITH 3000000000');
    const alice = await person('alice'), bob = await person('bob-private');
    otherIds.push(bob.id, bob.auth); secrets.push(bob.email);
    const af = await fixture(alice, bob);
    // Bob fixtures use the same projection sources, but never appear in Alice's export.
    const bf = await fixture(bob, alice);
    // Bob's teammate post in his brand is Alice's: remove that fixture's forbidden text.
    await q("UPDATE public.social_posts SET global_text='Alice own text' WHERE created_by_user_id=$1 AND global_text='teammate-secret'", [alice.id]);
    await q("UPDATE public.jobs SET inputs=jsonb_build_object('prompt','bob-private') WHERE user_id=$1", [bob.id]);
    await q("INSERT INTO public.referral_codes(user_id,code) VALUES($1,'ABCDEFGH23'),($2,'ABCDEFGH24')", [alice.id, bob.id]);
    await q("INSERT INTO public.referrals(referee_user_id,referrer_user_id,code) VALUES($1,$2,'ABCDEFGH24')", [alice.id, bob.id]);
    for (let i = 0; i < 204; i++) {
        const who = await person('public-handle', false); otherIds.push(who.id, who.auth);
        await q('INSERT INTO public.cinema_creator_follows(user_id,creator_id,created_at) VALUES($1,$2,now())', [alice.id, who.id]);
        await q('INSERT INTO public.user_blocks(blocker_id,blocked_id) VALUES($1,$2)', [alice.id, who.id]);
    }
    // delete_user_job only removes a settled job (STORED/FAILED/REFUNDED).
    const deleted = await one("INSERT INTO public.jobs(user_id,idempotency_key,model_id,credits,state,inputs) VALUES($1,$2,'test-model',1,'STORED','{}'::jsonb) RETURNING id", [alice.id, randomUUID()]);
    assert.equal((await one('SELECT public.delete_user_job($1,$2) AS r', [alice.auth, deleted.id])).r.ok, true);
    const goneThread = await one("INSERT INTO public.chat_threads(user_id,model_id) VALUES($1,'test-model') RETURNING id", [alice.id]);
    await q('SELECT public.chat_delete_thread($1,$2)', [alice.auth, goneThread.id]);
    const future = await one("INSERT INTO public.jobs(user_id,idempotency_key,model_id,credits,state,inputs,created_at) VALUES($1,$2,'test-model',1,'SUCCEEDED','{}'::jsonb,now()+interval '1 hour') RETURNING id", [alice.id, randomUUID()]);
    secrets.push(deleted.id, goneThread.id, future.id, bf.thread);
    const money = () => q("SELECT 'ledger' AS kind, count(*)::text AS n, md5(COALESCE(string_agg(to_jsonb(l)::text, '' ORDER BY l.id),'')) AS digest FROM public.ledger_entries l UNION ALL SELECT 'balance',count(*)::text,md5(COALESCE(string_agg(to_jsonb(b)::text,'' ORDER BY b.user_id),'')) FROM public.credit_balances b");
    // 101 more devices than the cap; the oldest-seen fall off the unpaged profile list.
    await q(`INSERT INTO public.push_tokens(user_id,token,platform,last_seen_at)
        SELECT $1, 'ExpoPushToken[' || md5(random()::text || g) || ']', 'android', now() - make_interval(mins => g) FROM generate_series(1,101) g`, [alice.id]);
    secrets.push(...(await q('SELECT token FROM public.push_tokens WHERE user_id=$1', [alice.id])).map(x => x.token));
    const before = await money();
    const request = await start(alice.auth); assert.equal(request.ok, true);
    assert.equal(request.resumed, false); keys(request, 'ok export_id as_of expires_at resumed');
    assert.equal(Date.parse(request.expires_at) - Date.parse(request.as_of), 3600000);
    const resumed = await start(alice.auth); assert.equal(resumed.export_id, request.export_id); assert.equal(resumed.resumed, true);
    assert.equal((await read(bob.auth, request.export_id, 'profile')).error, 'export_not_found');
    assert.deepEqual((await read(alice.auth, request.export_id, 'chat_messages', null, null, bf.thread)).rows, []);
    assert.equal((await read(alice.auth, request.export_id, 'invalid')).error, 'invalid_section');
    assert.equal((await read(alice.auth, request.export_id, 'creations', null, 201)).error, 'invalid_section');
    const all = {};
    for (const section of Object.keys(ALLOW)) {
        all[section] = await walk(alice, request.export_id, section, null, section === 'chat_messages' ? af.thread : null);
        assert.ok(all[section].length > 0, `${section} fixture must exercise its projection`);
    }
    assert.equal(all.creations.length, 201); assert.equal(all.chat_messages.length, 51);
    assert.equal(all.blocks.length, 205); assert.equal(all.creator_follows.length, 205);
    assert.ok(BigInt(all.chat_messages[0].seq) >= 3000000000n);
    const profile = all.profile[0];
    keys(profile.cinema_profile, 'username display_name bio created_at'); keys(profile.cinema_membership, 'role account_status');
    keys(profile.referral_code, 'code created_at'); for (const device of profile.push_devices) keys(device, 'platform notify_jobs created_at last_seen_at disabled_at');
    assert.equal(profile.push_devices.length, 100, 'push_devices is capped at 100');
    const seen = profile.push_devices.map(d => Date.parse(d.last_seen_at));
    assert.ok(seen.every((t, i) => i === 0 || seen[i - 1] >= t), 'most recently seen first');
    assert.ok(!profile.push_devices.some(d => d.last_seen_at && Date.parse(d.last_seen_at) < Date.now() - 100 * 60000 - 1000), 'oldest devices dropped');
    const sanctions = (await one('SELECT public.list_my_sanctions($1) AS r', [alice.auth])).r;
    assert.equal(profile.frozen, sanctions.frozen); assert.equal(profile.sanctions_hold_until, sanctions.hold_until);
    assert.deepEqual(all.sanctions, sanctions.sanctions);
    assert.deepEqual(await money(), before, 'export never writes credits or ledger');
    // Watch progress orders by content id, not its mutable timestamp; top-up state can change.
    const firstWatch = await read(alice.auth, request.export_id, 'watch_progress', null, 1);
    await q('UPDATE public.cinema_watch_resume SET updated_at=now()+interval \'2 hours\',position_seconds=6 WHERE user_id=$1', [alice.id]);
    const restWatch = await walk(alice, request.export_id, 'watch_progress', 1, null, firstWatch.next);
    assert.equal(new Set([...firstWatch.rows, ...restWatch].map(x => x.content_id)).size, 2);
    const firstTop = await read(alice.auth, request.export_id, 'top_ups', null, 1);
    const secondTop = all.top_ups.find(row => row.id !== firstTop.rows[0].id);
    const credited = await one("SELECT public.credit_top_up($1,$2,300,'USD','123') AS r", [secondTop.id, randomUUID().replaceAll('-', '')]);
    assert.equal(credited.r.ok, true);
    const afterPayment = await money();
    const restTop = await walk(alice, request.export_id, 'top_ups', 1, null, firstTop.next);
    assert.equal(restTop.length, 1); assert.equal(restTop[0].status, 'credited');
    assert.equal(new Set([...firstTop.rows, ...restTop].map(row => row.id)).size, 2);
    assert.deepEqual(await money(), afterPayment, 'reads after payment never change money');
    // Delete a boundary block through the real RPC; salted keys remain usable after removal.
    const blockPage = await read(alice.auth, request.export_id, 'blocks', null, 2);
    await q('SELECT public.unblock_cinema_user($1,$2)', [alice.auth, blockPage.rows[1].blocked_username]);
    const remainingBlocks = await walk(alice, request.export_id, 'blocks', 2, null, blockPage.next);
    assert.equal(remainingBlocks.length, 203); assert.equal(new Set(remainingBlocks.map(x => x.blocked_username)).size, 203);
    assert.ok(remainingBlocks.every(x => !blockPage.rows.some(y => y.blocked_username === x.blocked_username)));
    // All follows share an explicit timestamp. Remove an already returned row, before the boundary.
    const followsPage = await read(alice.auth, request.export_id, 'creator_follows', null, 2);
    await q('DELETE FROM public.cinema_creator_follows f USING public.cinema_profiles p WHERE f.user_id=$1 AND f.creator_id=p.user_id AND p.username=$2', [alice.id, followsPage.rows[0].creator_username]);
    const remainingFollows = await walk(alice, request.export_id, 'creator_follows', 2, null, followsPage.next);
    assert.equal(remainingFollows.length, 203); assert.equal(new Set(remainingFollows.map(x => x.creator_username)).size, 203);
    // Hard-deleting the second of three threads must not skip the third.
    await q("INSERT INTO public.chat_threads(user_id,model_id) SELECT $1,'test-model' FROM generate_series(1,2)", [alice.id]);
    const threadPage = await read(alice.auth, request.export_id, 'chat_threads', null, 2);
    await q('SELECT public.chat_delete_thread($1,$2)', [alice.auth, threadPage.rows[1].id]);
    const remainingThreads = await walk(alice, request.export_id, 'chat_threads', 2, null, threadPage.next);
    assert.equal(remainingThreads.length, 1); assert.ok(!threadPage.rows.some(x => x.id === remainingThreads[0].id));
    // Use a separate 5,000-message thread to inspect the real indexed predicate.
    const big = await one("INSERT INTO public.chat_threads(user_id,model_id) VALUES($1,'test-model') RETURNING id", [alice.id]);
    await q("INSERT INTO public.chat_messages(thread_id,role,content) SELECT $1,'user','index fixture' FROM generate_series(1,5000)", [big.id]);
    await q('ANALYZE public.chat_messages');
    const plan = await q('EXPLAIN SELECT id FROM public.chat_messages WHERE thread_id=$1 AND seq>$2::bigint AND created_at<=$3 ORDER BY seq LIMIT 50', [big.id, '3000000000', request.as_of]);
    const planText = plan.map(x => x['QUERY PLAN']).join('\n'); assert.match(planText, /chat_messages_thread_idx/); console.log(planText);
    const mfa = await person('mfa', false);
    await q("INSERT INTO auth.mfa_factors VALUES($1,'totp','unverified')", [mfa.auth]);
    const mr = await start(mfa.auth); assert.equal(mr.ok, true);
    await q("UPDATE auth.mfa_factors SET status='verified' WHERE user_id=$1", [mfa.auth]);
    assert.equal((await start(mfa.auth)).error, 'mfa_required'); assert.equal((await start(mfa.auth, 'aal2')).ok, true);
    assert.equal((await read(mfa.auth, mr.export_id, 'profile')).error, 'mfa_required');
    assert.equal((await read(mfa.auth, mr.export_id, 'profile', null, null, null, 'aal2')).ok, true);
    const frozen = await person('frozen', false), fr = await start(frozen.auth);
    await q("SELECT public.freeze_account($1,'op-note-secret',NULL)", [frozen.id]);
    assert.equal((await start(frozen.auth)).error, 'account_restricted'); assert.equal((await read(frozen.auth, fr.export_id, 'profile')).error, 'account_restricted');
    const held = await person('held', false), hr = await start(held.auth);
    const heldJob = await one("INSERT INTO public.jobs(user_id,idempotency_key,model_id,credits,state,inputs) VALUES($1,$2,'test-model',1,'SUCCEEDED','{}'::jsonb) RETURNING id", [held.id, randomUUID()]);
    await q("INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes,held_at) VALUES($1,'held-fixture','image/png',1,now())", [heldJob.id]);
    assert.equal((await start(held.auth)).error, 'account_restricted'); assert.equal((await read(held.auth, hr.export_id, 'profile')).error, 'account_restricted');
    const erased = await person('erased', false), er = await start(erased.auth);
    const prep = (await one('SELECT public.prepare_account_deletion($1) AS r', [erased.auth])).r;
    assert.equal((await one('SELECT public.erase_account($1,$2) AS r', [erased.auth, prep.confirmation_token])).r.ok, true);
    assert.equal((await start(erased.auth)).error, 'account_not_found'); assert.equal((await read(erased.auth, er.export_id, 'profile')).error, 'export_not_found');
    for (const age of [2, 25]) {
        const expired = await person('expired', false);
        const past = await one(`INSERT INTO public.privacy_export_requests(user_id,created_at,as_of,expires_at,aal)
            VALUES($1,now()-make_interval(hours=>$2),now()-make_interval(hours=>$2),now()-interval '1 hour','aal1') RETURNING id`, [expired.id, age]);
        const result = await start(expired.auth);
        if (age === 2) { assert.equal(result.error, 'rate_limited'); assert.ok(Math.abs(result.retry_after_seconds - 79200) <= 1); }
        else { assert.equal(result.ok, true); assert.notEqual(result.export_id, past.id); }
        assert.equal((await read(expired.auth, past.id, 'profile')).error, 'export_expired');
    }
    await reject('UPDATE public.privacy_export_requests SET aal=aal'); await reject('DELETE FROM public.privacy_export_requests'); await reject('TRUNCATE public.privacy_export_requests');
    for (const role of ['anon', 'authenticated', 'service_role']) {
        await q('SAVEPOINT role_check'); await q(`SET LOCAL ROLE ${role}`);
        await reject('SELECT * FROM public.privacy_export_requests', [], '42501');
        if (role !== 'service_role') {
            await reject('SELECT public.start_privacy_export($1,$2)', [alice.auth, 'aal1'], '42501');
            await reject('SELECT public.read_privacy_export_page($1,$2,$3,$4,NULL,NULL,NULL,NULL)', [alice.auth, 'aal1', request.export_id, 'profile'], '42501');
        }
        await q('ROLLBACK TO SAVEPOINT role_check');
    }
    assert.deepEqual(await q('SELECT * FROM public.reconcile_balances()'), []);
    const EXPORTED = new Set([
        'account_actions', 'chat_folders', 'chat_personas', 'chat_threads', 'cinema_creator_follows',
        'cinema_memberships', 'cinema_profiles', 'cinema_saved_titles', 'cinema_series_follows', 'cinema_watch_resume',
        'content_appeals', 'content_reports', 'credit_balances', 'credit_subscriptions', 'jobs',
        'ledger_entries', 'push_tokens', 'referral_codes', 'referrals', 'social_brands',
        'social_posts', 'social_publish_subscriptions', 'top_ups', 'user_blocks',
    ]);
    const NOT_EXPORTED = new Set([
        'account_deletions', 'account_read_rate_limits', 'api_requests', 'asset_link_rate_limits', 'chat_closed_sends',
        'cinema_audience_clock', 'cinema_competitions', 'cinema_creator_applications', 'cinema_free_plays', 'cinema_pass_plays',
        'cinema_passes', 'cinema_ranking_decisions', 'cinema_ranking_snapshots', 'cinema_retention_requests', 'cinema_share_actions',
        'cinema_story_polls', 'cinema_submissions', 'cinema_unlock_rate_limits', 'cinema_unlocks', 'cinema_watch_sessions',
        'editor_library_renders', 'editor_requests', 'film_library_masters', 'generation_attempt_rate_limits', 'job_read_rate_limits',
        'model_free_allowance_claims', 'organisation_members', 'privacy_export_requests', 'project_members', 'provider_spend_reservations',
        'push_outbox', 'push_token_writes', 'referral_rewards', 'social_account_actions', 'social_ad_campaigns',
        'social_api_keys', 'social_approval_events', 'social_approval_requests', 'social_brand_invitations', 'social_brand_members',
        'social_commerce_products', 'social_connection_selections', 'social_inbox_actions', 'social_inbox_contact_profiles', 'social_inbox_notes',
        'social_inbox_suggestions', 'social_inbox_threads', 'social_inbox_workflows', 'social_oauth_states', 'social_post_write_rate_limits',
        'social_publish_autolists', 'social_report_templates', 'social_team_events', 'social_uploads', 'social_webhook_endpoints',
        'store_customers', 'top_up_checkout_rate_limits', 'top_up_flagged_orders', 'top_up_read_rate_limits', 'top_up_return_rate_limits',
        'upload_request_rate_limits', 'upload_reservations', 'workspace_members',
    ]);
    const refs = await q(`SELECT DISTINCT c.conrelid::regclass::text AS tbl FROM pg_constraint c
        WHERE c.contype='f' AND c.confrelid IN ('public.users'::regclass,'auth.users'::regclass)`);
    const live = new Set(refs.map(r => r.tbl.replace(/^(public|private)\./, '')));
    const classified = new Set([...EXPORTED, ...NOT_EXPORTED]);
    assert.deepEqual([...live].filter(t => !classified.has(t)), [], 'unclassified user data');
    assert.deepEqual([...classified].filter(t => !live.has(t)), [], 'stale export classification');
    console.log('Privacy export: projections, isolation, cursors, refusals, grants, money and drift guards passed');
} finally { await q('ROLLBACK'); await c.end(); }

// Never leave committed append-only fixtures in the shared replay database.
const admin = new pg.Client({ connectionString: serverUrl });
const lockUrl = new URL(serverUrl); lockUrl.pathname = '/privacy_export_lock_check';
let created = false, a, b;
await admin.connect();
try {
    // Deliberately fail if someone else owns a database with this name; never drop their database.
    await admin.query('CREATE DATABASE privacy_export_lock_check'); created = true;
    await promisify(execFile)(process.execPath, ['scripts/replay-migrations.mjs'], {
        cwd: new URL('..', import.meta.url), env: { ...process.env, DATABASE_URL: lockUrl.href }, maxBuffer: 8 * 1024 * 1024,
    });
    a = new pg.Client({ connectionString: lockUrl.href }); b = new pg.Client({ connectionString: lockUrl.href });
    await a.connect(); await b.connect();
    await a.query('CREATE TABLE IF NOT EXISTS auth.mfa_factors(user_id uuid,factor_type text,status text)');
    const auth = randomUUID();
    await a.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, `${auth}@example.invalid`]);
    const moneyBefore = await a.query('SELECT count(*) AS n FROM public.ledger_entries');
    await a.query('BEGIN');
    const first = (await a.query("SELECT public.start_privacy_export($1,'aal1') AS r", [auth])).rows[0].r;
    assert.equal(first.ok, true);
    await b.query("SET lock_timeout='500ms'");
    await assert.rejects(b.query("SELECT public.start_privacy_export($1,'aal1')", [auth]), e => e.code === '55P03');
    await a.query('COMMIT');
    const second = (await b.query("SELECT public.start_privacy_export($1,'aal1') AS r", [auth])).rows[0].r;
    assert.equal(second.export_id, first.export_id); assert.equal(second.resumed, true);
    assert.deepEqual((await a.query('SELECT count(*) AS n FROM public.ledger_entries')).rows, moneyBefore.rows);
    console.log('Privacy export: two-client lock check passed');
} finally {
    await a?.end(); await b?.end();
    if (created) await admin.query('DROP DATABASE privacy_export_lock_check');
    await admin.end();
}
