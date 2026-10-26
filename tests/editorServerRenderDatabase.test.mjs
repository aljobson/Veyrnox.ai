import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { quoteDatabaseTests } from './helpers/editorServerRenderQuoteDatabase.mjs';
import { fixtureSQL } from './helpers/editorServerRenderDatabase.mjs';

const url = process.env.EDITOR_RENDER_TEST_DATABASE_URL;
function query(text) {
    return new Promise((resolve, reject) => {
        const child = execFile('psql', [url, '-XAt', '-v', 'ON_ERROR_STOP=1'], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => error ? reject(new Error(stderr)) : resolve(stdout.trim().split('\n').at(-1)));
        child.stdin.end(text);
    });
}
// Wait for the first transaction to hold its lock before starting the rival.
function lockedTransaction(before, after) {
    let unlockReady;
    const ready = new Promise(resolve => { unlockReady = resolve; });
    let child;
    const done = new Promise((resolve, reject) => {
        child = execFile('psql', [url, '-XAt', '-v', 'ON_ERROR_STOP=1'], { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            unlockReady();
            if (error) reject(new Error(stderr)); else resolve(stdout);
        });
        child.stdout.on('data', chunk => { if (chunk.includes('ESR_LOCKED')) unlockReady(); });
        child.stdin.end(`BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='5s'; ${before}
\\echo ESR_LOCKED
SELECT pg_sleep(0.3); ${after} COMMIT;`);
    });
    // A deliberately refused browser reservation is observed through done.
    done.catch(() => {});
    return { ready, done };
}
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const U = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const hash = 'a'.repeat(64);
const document = JSON.parse(readFileSync(new URL('./fixtures/editorServerRender/v2.json', import.meta.url)));
const admit = key => `SELECT public.admit_server_render('${A}',${q(key)},${q(JSON.stringify({ timeline: document }))}::jsonb,'1080p',5,'Test');`;
const finalize = id => `SELECT public.finalize_server_render('${id}',10,'${hash}',1920,1080,5,30);`;
const json = async text => JSON.parse(await query(text));

test('PostgreSQL: settlement, refund races, shared capacity and evidence preservation', { skip: !url && 'Set EDITOR_RENDER_TEST_DATABASE_URL to an empty disposable local database' }, async t => {
    const parsed = new URL(url);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname));
    assert.match(parsed.pathname, /test/i, 'database must be explicitly named as a test database');
    await query(fixtureSQL());
    await query(`INSERT INTO auth.users VALUES('${A}'); INSERT INTO public.users(id,auth_id,email) VALUES('${U}','${A}','test@example.test');
     INSERT INTO public.users(id,auth_id,email,is_admin) VALUES('${ADMIN}','${ADMIN}','admin@example.test',true);
     INSERT INTO public.credit_balances(user_id,balance) VALUES('${U}',10000);
     INSERT INTO public.ledger_entries(user_id,delta,reason) VALUES('${U}',10000,'grant:test');`);
    // Keep the real ledger throttle enabled, but isolate each scenario from
    // earlier fixtures consuming its ten-job/minute budget. Two minutes is
    // still inside the upload-grant window; no production function is stubbed.
    t.beforeEach(() => query(`UPDATE public.jobs SET created_at=least(created_at,now()-interval '2 minutes') WHERE user_id='${U}';`));
    await quoteDatabaseTests(t, { query, json, authId: A, userId: U });
    await t.test('active catalog bills exact 10s/15s units, rounds up and enforces v1 caps', async () => {
        assert.equal(await query("SELECT active AND cost_unit='per_second' AND credits_5s=1 AND billing_seconds=10 FROM public.model_catalog WHERE id='editor-server-render';"), 't');
        for (const [resolution, seconds, credits] of [
            ['1080p', .01, 1], ['1080p', 10, 1], ['1080p', 10.001, 2], ['1080p', 120, 12],
            ['720p', .01, 1], ['720p', 15, 1], ['720p', 15.001, 2], ['720p', 300, 20],
        ]) {
            const result = await json(`SELECT public.admit_server_render('${A}','price-${resolution}-${seconds}',${q(JSON.stringify({ timeline: document }))}::jsonb,'${resolution}',${seconds},'Test');`);
            assert.equal(result.credits, credits);
            assert.equal(await query(`SELECT -delta FROM public.ledger_entries WHERE job_id='${result.job_id}' AND delta<0;`), String(credits));
            await query(`SELECT public.fail_server_render('${result.job_id}','user_cancelled'); UPDATE public.jobs SET created_at=now()-interval '2 minutes' WHERE id='${result.job_id}';`);
        }
        for (const [resolution, seconds] of [['1080p', 120.01], ['720p', 300.01]]) {
            const result = await json(`SELECT public.admit_server_render('${A}','cap-${resolution}', '{}'::jsonb,'${resolution}',${seconds},'Test');`);
            assert.equal(result.code, 'INVALID_RENDER');
        }
    });
    await t.test('upload grant replays are bounded and cannot extend the deadline indefinitely', async () => {
        const id = (await json(admit('database-grant-bound'))).job_id;
        await query(`UPDATE public.jobs SET created_at=now()-interval '20 minutes' WHERE id='${id}';`);
        for (let i = 0; i < 4; i++) assert.equal((await json(`SELECT public.server_render_upload_grant('${id}',10);`)).ok, true);
        const expires = await query(`SELECT editor_render_upload_expires_at FROM public.jobs WHERE id='${id}';`);
        assert.equal((await json(`SELECT public.server_render_upload_grant('${id}',10);`)).code, 'UPLOAD_CLOSED');
        assert.equal(await query(`SELECT editor_render_upload_expires_at FROM public.jobs WHERE id='${id}';`), expires);
        await query(`SELECT public.fail_server_render('${id}','user_cancelled');`);
    });
    await t.test('two persisted unknown polls are required; callbacks and running polls reset loss', async () => {
        const id = (await json(admit('database-unknown-polls'))).job_id;
        await query(`UPDATE public.jobs SET created_at=now()-interval '5 minutes' WHERE id='${id}';`);
        const observe = state => json(`SELECT public.observe_server_render('${id}',${q(state)},clock_timestamp());`);
        assert.equal((await observe('unknown')).lost, false);
        await query(`UPDATE public.jobs SET editor_render_unknown_at=now()-interval '2 minutes' WHERE id='${id}'; SELECT public.record_server_render_activity('${id}');`);
        assert.equal((await observe('unknown')).lost, false);
        assert.equal(await query(`SELECT state FROM public.jobs WHERE id='${id}';`), 'SUBMITTED');
        assert.equal((await observe('running')).lost, false);
        assert.equal(await query(`SELECT editor_render_unknown_at IS NULL FROM public.jobs WHERE id='${id}';`), 't');
        assert.equal((await observe('unknown')).lost, false);
        // A callback arriving during a poll must win even if the poll returns unknown.
        await query(`SELECT public.record_server_render_activity('${id}');`);
        assert.equal((await json(`SELECT public.observe_server_render('${id}','unknown',now()-interval '1 minute');`)).lost, false);
        assert.equal(await query(`SELECT editor_render_unknown_at IS NULL FROM public.jobs WHERE id='${id}';`), 't');
        await observe('unknown');
        await query(`UPDATE public.jobs SET editor_render_unknown_at=now()-interval '2 minutes',editor_render_last_callback_at=now()-interval '3 minutes' WHERE id='${id}';`);
        const callback = lockedTransaction(`SELECT id FROM public.jobs WHERE id='${id}' FOR UPDATE;`,
            `SELECT public.record_server_render_activity('${id}');`);
        await callback.ready;
        const [, raced] = await Promise.all([callback.done, observe('unknown')]);
        assert.equal(raced.lost, false, 'callback arriving during a poll wins the job lock');
        assert.equal(await query(`SELECT state FROM public.jobs WHERE id='${id}';`), 'SUBMITTED');
        await query(`UPDATE public.jobs SET editor_render_unknown_at=now()-interval '2 minutes',editor_render_last_callback_at=now()-interval '3 minutes' WHERE id='${id}';`);
        assert.equal((await observe('unknown')).lost, true);
        assert.equal(await query(`SELECT state FROM public.jobs WHERE id='${id}';`), 'REFUNDED');
        assert.equal(await query(`SELECT count(*) FROM public.ledger_entries WHERE job_id='${id}' AND delta>0;`), '1');
        assert.equal(await query(`SELECT count(*) FROM public.asset_reap_queue WHERE r2_key=(SELECT editor_render_output_key FROM public.jobs WHERE id='${id}');`), '1');
    });
    let settled;
    await t.test('admit and refund interleave with the real dispute freeze without reversing balance/user locks', async () => {
        const id = (await json(admit('database-dispute-refund'))).job_id;
        await query(`INSERT INTO public.top_ups(user_id,order_id) VALUES('${U}','123456');`);
        const dispute = lockedTransaction(`SELECT user_id FROM public.credit_balances WHERE user_id='${U}' FOR UPDATE;`,
            `SELECT public.apply_dispute_event('123456','created','test-dispute');`);
        await dispute.ready;
        const [, refused, refunded] = await Promise.all([dispute.done, json(admit('database-disputed-admit')),
            json(`SELECT public.fail_server_render('${id}','user_cancelled');`)]);
        assert.equal(refused.ok, false);
        assert.equal(refunded.state, 'REFUNDED');
        assert.equal(await query(`SELECT count(*) FROM public.jobs WHERE idempotency_key='database-disputed-admit';`), '0');
        assert.equal(await query(`SELECT count(*) FROM public.ledger_entries WHERE job_id='${id}' AND delta>0;`), '1');
        assert.equal((await json(`SELECT public.unfreeze_account('${U}','test operator','Finished lock-order test');`)).ok, true);
    });
    await t.test('create replay, atomic STORED and shared timeout immunity', async () => {
        const one = await json(admit('database-create-1')); settled = one.job_id;
        assert.equal((await json(admit('database-create-1'))).job_id, settled);
        assert.equal(await query(`SELECT count(*) FROM public.ledger_entries WHERE job_id='${settled}' AND delta<0;`), '1');
        await json(`SELECT public.server_render_upload_grant('${settled}',10);`);
        assert.equal((await json(finalize(settled))).state, 'STORED');
        assert.equal((await json(finalize(settled))).idempotent, true);
        await query(`UPDATE public.jobs SET updated_at=now()-interval '3 hours' WHERE id='${settled}'; SELECT public.sweep_stuck_jobs();`);
        assert.equal(await query(`SELECT state FROM public.jobs WHERE id='${settled}';`), 'STORED');
        assert.equal((await json(`SELECT public.fail_server_render('${settled}','late_failure');`)).state, 'STORED');
        assert.equal(await query(`SELECT count(*) FROM public.assets WHERE job_id='${settled}';`), '1');
        const page = await json(`SELECT set_config('request.jwt.claim.sub','${A}',false); SELECT private.read_editor_library_renders();`);
        assert.equal(page.renders.length, 1);
        assert.equal(Object.hasOwn(page.renders[0], 'asset_id'), false);
        assert.equal(Object.hasOwn(page.renders[0], 'source_job_id'), false);
    });
    await t.test('generated sources with multiple assets are rejected', async () => {
        assert.equal((await json(`SELECT public.server_render_source('${A}','j-${settled}');`)).ok, true);
        await query(`INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes) VALUES('${settled}','test-extra-asset','video/mp4',10);`);
        assert.equal((await json(`SELECT public.server_render_source('${A}','j-${settled}');`)).ok, false);
        await query("DELETE FROM public.assets WHERE r2_key='test-extra-asset';");
    });
    await t.test('linked removal preserves rate-limit, frozen, held, in-progress and in-use errors', async () => {
        const rid = await query(`SELECT id FROM public.editor_library_renders WHERE source_job_id='${settled}';`);
        const cases = [
            ['PT429', 'RATE_LIMITED', "SET LOCAL esr.test_rate_limited='true';"],
            ['PT403', 'ACCOUNT_FROZEN', `UPDATE public.users SET frozen_at=now() WHERE id='${U}';`],
            ['PT409', 'IN_PROGRESS', `UPDATE public.jobs SET state='SUBMITTED' WHERE id='${settled}';`],
            ['PT409', 'ON_HOLD', `UPDATE public.assets SET held_at=now() WHERE job_id='${settled}';`],
            ['PT409', 'USED_BY_POST', `INSERT INTO public.social_posts VALUES('${A}','published'); INSERT INTO public.social_post_media VALUES('${A}','${settled}');`],
            ['PT409', 'USED_BY_CINEMA', `INSERT INTO public.cinema_uploads VALUES('${settled}');`],
            ['PT409', 'USED_BY_LIBRARY', `INSERT INTO public.film_library_masters(source_job_id) VALUES('${settled}');`],
        ];
        for (const [state, code, setup] of cases) {
            await assert.rejects(query(`\\set VERBOSITY verbose
BEGIN; SELECT set_config('request.jwt.claim.sub','${A}',true); ${setup}
SELECT private.remove_editor_library_render('${rid}'); ROLLBACK;`), error => error.message.includes(state) && error.message.includes(code));
        }
        assert.equal(await query(`SELECT count(*) FROM public.assets WHERE job_id='${settled}';`), '1');
    });
    await t.test('cancel wins against finalize; grant refuses cancelled work', async () => {
        const id = (await json(admit('database-cancel-1'))).job_id;
        await query(`SELECT public.server_render_upload_grant('${id}',10);`);
        const cancellation = lockedTransaction(`SELECT public.fail_server_render('${id}','user_cancelled');`, '');
        await cancellation.ready;
        await Promise.all([cancellation.done, query(finalize(id))]);
        assert.equal(await query(`SELECT state FROM public.jobs WHERE id='${id}';`), 'REFUNDED');
        assert.equal((await json(`SELECT public.server_render_upload_grant('${id}',10);`)).ok, false);
        assert.equal(await query(`SELECT count(*) FROM public.ledger_entries WHERE job_id='${id}' AND delta>0;`), '1');
    });
    await t.test('finalize holding the owner lock wins against concurrent cancel without deadlock', async () => {
        const id = (await json(admit('database-finalize-race'))).job_id;
        await query(`SELECT public.server_render_upload_grant('${id}',10);`);
        const settlement = lockedTransaction(`SELECT pg_advisory_xact_lock(261,hashtext('${U}'));`, finalize(id));
        await settlement.ready;
        const [, cancelled] = await Promise.all([settlement.done, json(`SELECT public.fail_server_render('${id}','user_cancelled');`)]);
        assert.equal(cancelled.state, 'STORED');
        assert.equal(await query(`SELECT count(*) FROM public.ledger_entries WHERE job_id='${id}' AND delta>0;`), '0');
        assert.equal(await query(`SELECT count(*) FROM public.editor_library_renders WHERE source_job_id='${id}';`), '1');
    });
    await t.test('finalize does not invert the shared sweep job-before-balance refund order', async () => {
        const id = (await json(admit('database-shared-refund-race'))).job_id;
        await query(`SELECT public.server_render_upload_grant('${id}',10);`);
        const sweep = lockedTransaction(`SELECT id FROM public.jobs WHERE id='${id}' FOR UPDATE;`,
            `UPDATE public.jobs SET state='FAILED' WHERE id='${id}'; SELECT public.ledger_refund('${id}','${U}',(SELECT credits FROM public.jobs WHERE id='${id}'),'refund:timeout');`);
        await sweep.ready;
        const [, finalized] = await Promise.all([sweep.done, json(`SET lock_timeout='3s'; ${finalize(id)}`)]);
        assert.equal(finalized.code, 'JOB_CLOSED');
        assert.equal(await query(`SELECT state FROM public.jobs WHERE id='${id}';`), 'REFUNDED');
        assert.equal(await query(`SELECT count(*) FROM public.assets WHERE job_id='${id}';`), '0');
    });
    await t.test('server admission remains compatible with an existing ledger FK key-share lock', async () => {
        const ledger = lockedTransaction(`SELECT id FROM public.users WHERE id='${U}' FOR KEY SHARE;`, '');
        await ledger.ready;
        const [, admitted] = await Promise.all([ledger.done, json(`SET lock_timeout='100ms'; ${admit('database-key-share')}`)]);
        assert.equal(admitted.ok, true);
        await query(`SELECT public.fail_server_render('${admitted.job_id}','user_cancelled');`);
    });
    await t.test('new browser reservations cannot use server keys; old browser reservations still replay', async () => {
        const key = 'server-existing-browser';
        await query(`INSERT INTO public.editor_library_renders(owner_id,label,r2_key,sha256,size_bytes,request_key)
         VALUES('${A}','Existing','editor-renders/${A}/'||gen_random_uuid()||'.mp4','${hash}',10,'${key}');`);
        const call = k => `SELECT set_config('request.jwt.claim.sub','${A}',false); SELECT private.reserve_editor_library_render('Existing','${hash}',10,true,'${k}');`;
        assert.equal((await json(call(key))).idempotent, true);
        await assert.rejects(query(call('server-new-browser')), /INVALID_RENDER/);
    });
    for (const bound of ['count', 'bytes']) await t.test(`concurrent browser reservation/finalization near ${bound} limit`, async () => {
        // Remove unrelated fixtures without invoking any money mutation.
        await query('DELETE FROM public.assets; DELETE FROM public.editor_library_renders;');
        const n = bound === 'count' ? 99 : 7, size = bound === 'count' ? 1 : 25 * 1024 * 1024;
        await query(`INSERT INTO public.editor_library_renders(owner_id,label,r2_key,sha256,size_bytes,request_key)
         SELECT '${A}','Existing','editor-renders/${A}/'||gen_random_uuid()||'.mp4','${hash}',${size},'existing-'||g FROM generate_series(1,${n}) g;`);
        const id = (await json(admit(`database-capacity-${bound}`))).job_id;
        assert.ok(id, 'server reserves one item and 25 MiB before debit');
        await query(`SELECT public.server_render_upload_grant('${id}',10);`);
        // Browser owns the lock first, so it must account for the server's reservation.
        const browser = lockedTransaction(`SELECT set_config('request.jwt.claim.sub','${A}',false); SELECT pg_advisory_xact_lock(261,hashtext('${U}'));`,
            `SELECT private.reserve_editor_library_render('Browser','${hash}',${bound === 'count' ? 1 : 20 * 1024 * 1024},true,'browser-${bound}');`);
        await browser.ready;
        const [admitted] = await Promise.all([browser.done.then(() => true, () => false), query(finalize(id))]);
        assert.equal(admitted, false, 'browser cannot spend capacity already reserved by server');
        assert.equal(await query('SELECT count(*)<=100 AND sum(size_bytes)<=209715200 FROM public.editor_library_renders;'), 't');
        assert.equal(await query(`SELECT state FROM public.jobs WHERE id='${id}';`), 'STORED');
    });
    await t.test('Library removal deletes the canonical asset and delays byte reaping until grants expire', async () => {
        await query('DELETE FROM public.assets; DELETE FROM public.editor_library_renders;');
        const id = (await json(admit('database-remove-1'))).job_id;
        await query(`SELECT public.server_render_upload_grant('${id}',10); ${finalize(id)}`);
        const row = await json(`SELECT row_to_json(e) FROM public.editor_library_renders e WHERE source_job_id='${id}';`);
        await query(`SELECT set_config('request.jwt.claim.sub','${A}',false); SELECT private.remove_editor_library_render('${row.id}');`);
        assert.equal(await query(`SELECT count(*) FROM public.assets WHERE job_id='${id}';`), '0');
        assert.equal(await query(`SELECT count(*) FROM public.editor_library_renders WHERE source_job_id='${id}';`), '0');
        assert.equal(await query(`SELECT not_before>now() FROM public.asset_reap_queue WHERE r2_key=${q(row.r2_key)};`), 't');
        assert.equal(await query(`SELECT public.asset_reap_allowed(${q(row.r2_key)});`), 'f');
    });
    await t.test('deleting a refunded job inside its grant window preserves delayed cleanup without NULL keys', async () => {
        const id = (await json(admit('database-refund-delete'))).job_id;
        const key = await query(`SELECT editor_render_output_key FROM public.jobs WHERE id='${id}';`);
        await query(`SELECT public.server_render_upload_grant('${id}',10); SELECT public.fail_server_render('${id}','user_cancelled');`);
        // Refund itself must enqueue; no callback/sweep cleanup call is required.
        assert.equal(await query(`SELECT count(*) FROM public.asset_reap_queue WHERE r2_key=${q(key)};`), '1');
        assert.equal((await json(`SELECT public.delete_user_job('${A}','${id}');`)).ok, true);
        assert.equal(await query(`SELECT inputs='{}'::jsonb AND editor_render_output_key=${q(key)} FROM public.jobs WHERE id='${id}';`), 't');
        assert.equal(await query(`SELECT public.cleanup_server_render('${id}');`), 't');
        assert.equal(await query(`SELECT not_before>now() FROM public.asset_reap_queue WHERE r2_key=${q(key)};`), 't');
        assert.equal(await query(`SELECT public.asset_reap_allowed(${q(key)});`), 'f');
        await query(`UPDATE public.asset_reap_queue SET not_before=now()-interval '1 second' WHERE r2_key=${q(key)};`);
        assert.equal(await query(`SELECT public.asset_reap_allowed(${q(key)});`), 't');
        assert.equal(await query("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='asset_reap_queue' AND column_name='r2_key';"), 'NO');
        assert.equal(await query('SELECT count(*) FROM public.asset_reap_queue WHERE r2_key IS NULL;'), '0');
    });
    await t.test('upload sources survive PUT expiry for 24 hours and reject keys preserved by escalation', async () => {
        await query('DELETE FROM public.assets; DELETE FROM public.editor_library_renders;');
        const id = (await json(admit('database-upload-source'))).job_id;
        const key = `uploads/${A}/${id}.mp4`;
        await query(`INSERT INTO public.upload_reservations(user_id,r2_key,size_bytes) VALUES('${U}',${q(key)},10);
         SELECT public.job_stored('er_${id}','concat-render',${q(key)},'video/mp4',10,'${hash}');`);
        assert.equal((await json(`SELECT public.server_render_source('${A}','u-${id}');`)).ok, true);
        await query(`UPDATE public.upload_reservations SET created_at=now()-interval '20 minutes',put_expires_at=now()-interval '4 minutes' WHERE r2_key=${q(key)};`);
        assert.equal((await json(`SELECT public.server_render_source('${A}','u-${id}');`)).ok, true);
        await query(`UPDATE public.upload_reservations SET created_at=now()-interval '25 hours' WHERE r2_key=${q(key)};`);
        assert.equal((await json(`SELECT public.server_render_source('${A}','u-${id}');`)).ok, false);
        await query(`UPDATE public.upload_reservations SET created_at=now()-interval '20 minutes' WHERE r2_key=${q(key)};`);
        const event = await json(`SELECT public.record_csam_escalation('${ADMIN}','${U}','${id}','Test upload source','test-upload-preserve');`);
        assert.equal(event.preserved, 1);
        await query(`UPDATE public.users SET frozen_at=NULL WHERE id='${U}';`);
        assert.equal((await json(`SELECT public.server_render_source('${A}','u-${id}');`)).ok, false);
        // Even a residual canonical reference to that key cannot authorize it.
        await query(`INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes) VALUES('${id}',${q(key)},'video/mp4',10);`);
        assert.equal((await json(`SELECT public.server_render_source('${A}','j-${id}');`)).ok, false);
        assert.equal(await query(`SELECT count(*) FROM public.evidence_holds WHERE r2_key=${q(key)} AND released_at IS NULL;`), '1');
    });
    await t.test('permanently ineligible refund cleanup leaves the candidate query', async () => {
        const id = (await json(admit('database-cleanup-live-asset'))).job_id;
        const key = await query(`SELECT inputs->>'output_key' FROM public.jobs WHERE id='${id}';`);
        await query(`INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes) VALUES('${id}',${q(key)},'video/mp4',10);
         SELECT public.fail_server_render('${id}','user_cancelled');`);
        assert.equal(await query(`SELECT public.cleanup_server_render('${id}');`), 'f');
        assert.equal(await query(`SELECT inputs->>'cleanup_skipped' FROM public.jobs WHERE id='${id}';`), 'true');
        assert.equal(await query(`SELECT count(*) FROM public.asset_reap_queue WHERE r2_key=${q(key)};`), '0');
        assert.equal((await json(admit('database-cleanup-live-asset'))).idempotent, true);
    });
    await t.test('escalation removes delivery, never reaps held bytes; delete/expiry preserve evidence', async () => {
        await query('DELETE FROM public.assets; DELETE FROM public.editor_library_renders;');
        const id = (await json(admit('database-evidence-1'))).job_id;
        await query(`SELECT public.server_render_upload_grant('${id}',10); ${finalize(id)}`);
        const row = await json(`SELECT row_to_json(e) FROM public.editor_library_renders e WHERE source_job_id='${id}';`);
        const event = await json(`SELECT public.record_csam_escalation('${ADMIN}','${U}','${id}','Test preservation','test-preserve-1');`);
        assert.equal(event.preserved, 1);
        // Isolate key authorization from the escalation's account freeze.
        await query(`UPDATE public.users SET frozen_at=NULL WHERE id='${U}';`);
        assert.equal(await query(`SELECT count(*) FROM public.editor_library_renders WHERE id='${row.id}';`), '0');
        assert.equal((await json(`SELECT public.server_render_source('${A}','e-${row.id}');`)).ok, false);
        // A legacy browser row surviving independently is not permission to
        // consume the preserved key either (the helper checks the key itself).
        await query(`INSERT INTO public.editor_library_renders(id,owner_id,label,r2_key,sha256,size_bytes,request_key,state,width,height,seconds,frame_rate,inspected_at)
         VALUES('${row.id}','${A}','Legacy',${q(row.r2_key)},'${hash}',10,'legacy-held-render','stored',1920,1080,5,30,now());`);
        assert.equal((await json(`SELECT public.server_render_source('${A}','e-${row.id}');`)).ok, false);
        assert.equal((await json(`SELECT public.delete_user_job('${A}','${id}');`)).ok, false);
        await assert.rejects(query(`SELECT set_config('request.jwt.claim.sub','${A}',false); SELECT private.remove_editor_library_render('${row.id}');`));
        await query(`SELECT public.expire_editor_library_renders(); INSERT INTO public.asset_reap_queue(r2_key) VALUES(${q(row.r2_key)});`);
        assert.equal(await query(`SELECT count(*) FROM public.asset_reap_queue WHERE r2_key=${q(row.r2_key)};`), '0');
        assert.equal(await query(`SELECT public.asset_reap_allowed(${q(row.r2_key)});`), 'f');
        assert.equal(await query(`SELECT count(*) FROM public.evidence_holds WHERE r2_key=${q(row.r2_key)} AND released_at IS NULL;`), '1');
        // An explicit release must enqueue bytes after the active-hold guard.
        await query(`UPDATE public.jobs SET editor_render_upload_expires_at=now()-interval '1 minute' WHERE id='${id}';`);
        const released = await json(`SELECT public.release_evidence_hold('${ADMIN}','${event.action_id}','Test release after preservation');`);
        assert.equal(released.released, 1);
        assert.equal(await query(`SELECT not_before<=now() FROM public.asset_reap_queue WHERE r2_key=${q(row.r2_key)};`), 't');
        assert.equal(await query(`SELECT public.asset_reap_allowed(${q(row.r2_key)});`), 't');
        assert.equal((await json(`SELECT public.release_evidence_hold('${ADMIN}','${event.action_id}','Replay release');`)).released, 0);
        assert.equal(await query(`SELECT count(*) FROM public.asset_reap_queue WHERE r2_key=${q(row.r2_key)};`), '1');
    });
    assert.equal(await query(`SELECT b.balance=coalesce(sum(e.delta),0) FROM public.credit_balances b JOIN public.ledger_entries e ON e.user_id=b.user_id WHERE b.user_id='${U}' GROUP BY b.balance;`), 't');
});
