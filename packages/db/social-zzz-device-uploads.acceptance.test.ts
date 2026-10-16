import { isFullSocialReplay } from './test-support/social-acceptance-bootstrap.js';
import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('Publish device uploads (0223)', { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
    const call = async (sql: string, args: unknown[] = []) => (await one(`SELECT ${sql} AS r`, args)).r;
    const migration = () => readFile(new URL('./schema/supabase/0223_social_device_uploads.sql', import.meta.url), 'utf8');
    before(async () => {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
        if (await isFullSocialReplay(pool)) return;
        await pool.query(await migration()); await pool.query(await migration());
    });
    after(async () => { await pool?.end(); });
    async function user() {
        const auth = randomUUID();
        await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, `${auth}@test.veyrnox.ai`]);
        const id = await call('public.provision_user($1,$2)', [auth, `${auth}@test.veyrnox.ai`]);
        return { auth, id };
    }
    const reserve = (auth: string, id = randomUUID(), mime = 'image/png', size = 1024) =>
        call('public.reserve_social_upload($1,$2,$3,$4,$5)', [auth,id,'device.png',mime,size]);
    async function target(auth: string) {
        const brand = await call('public.get_or_create_default_social_brand($1)', [auth]);
        const account = await call('public.record_social_account_connection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
            [auth,brand.brand_id,'youtube',`test-${randomUUID()}`,'Test channel',null,['scope'],Buffer.from('test'),null,null]);
        assert.equal(account.ok,true);
        return { brandId:brand.brand_id, accountId:account.account_id };
    }
    const post = (auth: string, target: { brandId: string; accountId: string }, uploadId: string, mediaType = 'image') =>
        call('public.create_social_post($1,$2,$3,$4,$5,$6,$7)', [auth,target.brandId,new Date().toISOString(),'test',randomUUID(),[target.accountId],JSON.stringify([{ media_type:mediaType,upload_id:uploadId }])]);
    const waitForLock = async (pid: number) => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
            if ((await one('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).wait_event_type === 'Lock') return;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.fail('fixture query must be blocked on the held row lock');
    };
    async function orderedRemovalRace(first: 'schedule' | 'remove') {
        const u = await user(), t = await target(u.auth), file = await reserve(u.auth);
        await call('public.complete_social_upload($1,$2)', [u.auth,file.id]);
        const gate = await pool.connect(), scheduler = await pool.connect(), remover = await pool.connect();
        let gateOpen = false;
        let schedulePromise: Promise<pg.QueryResult> | undefined, removePromise: Promise<pg.QueryResult> | undefined;
        try {
            const schedulePid = (await scheduler.query('SELECT pg_backend_pid() pid')).rows[0].pid;
            const removePid = (await remover.query('SELECT pg_backend_pid() pid')).rows[0].pid;
            await gate.query('BEGIN'); gateOpen = true;
            await gate.query('SELECT id FROM public.users WHERE id=$1 FOR UPDATE', [u.id]);
            const schedule = () => scheduler.query('SELECT public.create_social_post($1,$2,now(),$3,$4,$5,$6::jsonb) r',
                [u.auth,t.brandId,'Ordered race',randomUUID(),[t.accountId],JSON.stringify([{ media_type:'image',upload_id:file.id }])]);
            const remove = () => remover.query('SELECT public.remove_social_upload($1,$2) r', [u.auth,file.id]);
            if (first === 'remove') {
                removePromise = remove(); await waitForLock(removePid);
                schedulePromise = schedule(); await waitForLock(schedulePid);
            } else {
                schedulePromise = schedule(); await waitForLock(schedulePid);
                removePromise = remove(); await waitForLock(removePid);
            }
            await gate.query('COMMIT'); gateOpen = false;
            const [scheduled,removed] = (await Promise.all([schedulePromise,removePromise])).map((result) => result.rows[0].r);
            assert.deepEqual(first === 'schedule' ? [scheduled.ok,removed.code] : [removed.ok,scheduled.code],
                first === 'schedule' ? [true,'UPLOAD_IN_USE'] : [true,'MEDIA_NOT_FOUND'],
                JSON.stringify({ first,scheduled:{ok:scheduled.ok,code:scheduled.code},removed:{ok:removed.ok,code:removed.code} }));
            assert.equal((await one(`SELECT count(*)::int n FROM public.social_posts p
                JOIN public.social_post_media m ON m.post_id=p.id JOIN public.social_uploads u ON u.id=m.source_upload_id
                WHERE m.source_upload_id=$1 AND p.status='scheduled' AND u.status<>'ready'`, [file.id])).n, 0);
        } finally {
            if (gateOpen) await gate.query('ROLLBACK');
            await Promise.allSettled([schedulePromise,removePromise].filter(Boolean));
            gate.release(); scheduler.release(); remover.release();
        }
    }
    it('reservations serialize concurrent storage limits for users with zero credits', async () => {
        const u = await user();
        const results = await Promise.all(Array.from({ length:12 }, () => reserve(u.auth)));
        assert.equal(results.filter((r) => r.ok).length,10);
        assert.equal(results.filter((r) => r.code === 'UPLOAD_BUDGET_EXCEEDED').length,2);
        const other = await user();
        assert.equal((await reserve(other.auth,randomUUID(),'video/mp4',104857600)).ok,true);
        assert.equal((await reserve(other.auth,randomUUID(),'video/mp4',104857600)).ok,true);
        assert.equal((await reserve(other.auth)).code,'UPLOAD_BUDGET_EXCEEDED');
    });
    it('only the owner can list, finalize or remove uploads; pending files cannot be posted', async () => {
        const u = await user(), stranger = await user(), t = await target(u.auth);
        const file = await reserve(u.auth);
        assert.equal((await call('public.read_social_upload($1,$2)',[stranger.auth,file.id])).uploads.length,0);
        assert.equal((await call('public.complete_social_upload($1,$2)',[stranger.auth,file.id])).code,'UPLOAD_NOT_FOUND');
        assert.equal((await call('public.remove_social_upload($1,$2)',[stranger.auth,file.id])).code,'UPLOAD_NOT_FOUND');
        assert.equal((await post(u.auth,t,file.id)).code,'MEDIA_NOT_FOUND');
        assert.equal((await call('public.complete_social_upload($1,$2)',[u.auth,file.id])).ok,true);
        assert.equal((await call('public.complete_social_upload($1,$2)',[u.auth,file.id])).ok,true);
        assert.equal((await call('public.read_social_upload($1)',[u.auth])).uploads.length,1);
        assert.equal((await post(u.auth,t,file.id,'video')).code,'MEDIA_NOT_FOUND');
        const strangerTarget = await target(stranger.auth);
        assert.equal((await post(stranger.auth,strangerTarget,file.id)).code,'MEDIA_NOT_FOUND');
        const scheduled = await post(u.auth,t,file.id);
        assert.equal(scheduled.ok,true);
        const claims = await pool.query('SELECT * FROM public.claim_due_social_post_targets(50)');
        const claimed = claims.rows.find((r) => r.post_id === scheduled.post_id);
        assert.equal(claimed.r2_key,file.r2_key); assert.equal(claimed.mime_type,'image/png'); assert.equal(Number(claimed.size_bytes),1024);
        assert.equal((await call('public.remove_social_upload($1,$2)',[u.auth,file.id])).code,'UPLOAD_IN_USE');
        // Exercise the historical migration's in-use invariant in a rolled-back
        // transaction: it must not replace current team-aware functions for the
        // remainder of this full-chain acceptance run.
        const replay = await pool.connect();
        try {
            await replay.query('BEGIN');
            await replay.query(await migration());
            assert.equal((await replay.query('SELECT public.remove_social_upload($1,$2) AS r', [u.auth,file.id])).rows[0].r.code,'UPLOAD_IN_USE');
        } finally { await replay.query('ROLLBACK'); replay.release(); }
        assert.equal((await call('public.remove_social_upload($1,$2)',[u.auth,file.id])).code,'UPLOAD_IN_USE');
        const completed = await call('public.complete_social_post_target($1,true,$2,$3,NULL,false,$4)',[claimed.target_id,'test-post','https://youtube.test/post',claimed.claim_key]);
        assert.equal(completed.ok,true);
        assert.equal((await call('public.remove_social_upload($1,$2)',[u.auth,file.id])).ok,true);
        await pool.query("UPDATE public.social_uploads SET put_expires_at = now() - interval '1 minute' WHERE id = $1",[file.id]);
        await call('public.release_social_upload($1)',[file.id]);
        assert.equal((await one('SELECT status FROM public.social_uploads WHERE id = $1',[file.id])).status,'deleted');
        assert.equal((await call('public.read_social_upload($1,$2)',[u.auth,file.id])).uploads.length,0);
        assert.equal((await post(u.auth,t,file.id)).code,'MEDIA_NOT_FOUND');
    });
    it('cleanup excludes ready files; deleted reservations remain counted until PUT expiry', async () => {
        const u = await user(); const ready = await reserve(u.auth), pending = await reserve(u.auth);
        await call('public.complete_social_upload($1,$2)',[u.auth,ready.id]);
        await pool.query("UPDATE public.social_uploads SET created_at = now() - interval '2 days', put_expires_at = now() - interval '1 day' WHERE id = ANY($1::uuid[])",[ [ready.id,pending.id] ]);
        const cleanup = (await pool.query('SELECT * FROM public.claim_social_upload_cleanup()')).rows;
        assert.ok(cleanup.some((r) => r.id === pending.id)); assert.ok(!cleanup.some((r) => r.id === ready.id));
        assert.equal((await call('public.complete_social_upload($1,$2)',[u.auth,pending.id])).code,'UPLOAD_NOT_FOUND');
        await call('public.release_social_upload($1)',[pending.id]);
        assert.equal((await one('SELECT count(*)::int AS n FROM public.social_uploads WHERE id = $1',[pending.id])).n,0);
        const removed = await reserve(u.auth);
        await call('public.remove_social_upload($1,$2)',[u.auth,removed.id]);
        await call('public.release_social_upload($1)',[removed.id]);
        assert.equal((await one('SELECT count(*)::int AS n FROM public.social_uploads WHERE id = $1',[removed.id])).n,1);
    });
    it('schedule versus removal is serialized; an accepted post never loses its file', async () => {
        const u = await user(), t = await target(u.auth), file = await reserve(u.auth);
        await call('public.complete_social_upload($1,$2)',[u.auth,file.id]);
        const [scheduled,removed] = await Promise.all([post(u.auth,t,file.id),call('public.remove_social_upload($1,$2)',[u.auth,file.id])]);
        assert.ok(scheduled.ok ? removed.code === 'UPLOAD_IN_USE' : removed.ok && scheduled.code === 'MEDIA_NOT_FOUND',
            JSON.stringify({ scheduled: { ok: scheduled.ok, code: scheduled.code }, removed: { ok: removed.ok, code: removed.code } }));
    });
    it('removal queued first cannot race a later schedule past media validation', async () => {
        await orderedRemovalRace('remove');
    });
    it('scheduling queued first keeps its file when removal resumes', async () => {
        await orderedRemovalRace('schedule');
    });
    it('accepts reversed multi-upload order without deadlock and preserves idempotency and malformed-input codes', async () => {
        const u = await user(), t = await target(u.auth), first = await reserve(u.auth), second = await reserve(u.auth);
        for (const file of [first,second]) await call('public.complete_social_upload($1,$2)', [u.auth,file.id]);
        const key = randomUUID(), otherKey = randomUUID();
        const make = (ids: string[], idempotencyKey: string) => call('public.create_social_post($1,$2,now(),$3,$4,$5,$6::jsonb)',
            [u.auth,t.brandId,'Multi upload',idempotencyKey,[t.accountId],JSON.stringify(ids.map((id) => ({ media_type:'image',upload_id:id })))]);
        const results = await Promise.all([make([first.id,second.id],key),make([second.id,first.id],otherKey)]);
        assert.ok(results.every((result) => result.ok === true), JSON.stringify(results.map((result) => ({ok:result.ok,code:result.code}))));
        const replay = await make([first.id,second.id],key);
        assert.equal(replay.idempotent,true); assert.equal(replay.post_id,results[0].post_id);
        const media = await pool.query('SELECT source_upload_id FROM public.social_post_media WHERE post_id=$1 ORDER BY position', [results[0].post_id]);
        assert.deepEqual(media.rows.map((row) => row.source_upload_id),[first.id,second.id]);
        assert.equal((await make(['not-a-uuid'],randomUUID())).code,'INVALID_MEDIA');
        assert.equal((await call('public.create_social_post($1,$2,now(),$3,$4,$5,$6::jsonb)',
            [u.auth,t.brandId,'Malformed',randomUUID(),[t.accountId],JSON.stringify({upload_id:first.id})])).code,'INVALID_MEDIA');
    });
    it('keeps malformed, duplicate, foreign-upload and simultaneous replay semantics unchanged', async () => {
        const u = await user(), t = await target(u.auth), file = await reserve(u.auth);
        const stranger = await user(), foreign = await reserve(stranger.auth);
        await call('public.complete_social_upload($1,$2)', [u.auth,file.id]);
        await call('public.complete_social_upload($1,$2)', [stranger.auth,foreign.id]);
        const make = (media: unknown, key = randomUUID()) => call('public.create_social_post($1,$2,now(),$3,$4,$5,$6::jsonb)',
            [u.auth,t.brandId,'Validation',key,[t.accountId],JSON.stringify(media)]);
        const descriptor = { media_type:'image',upload_id:file.id };
        for (const media of [null,[],[null],['upload_id'],[['upload_id']],
            [{media_type:'image',upload_id:null}],[{media_type:'image',upload_id:'bad'}],
            Array.from({length:11},()=>descriptor)]) {
            assert.equal((await make(media)).code,'INVALID_MEDIA', JSON.stringify(media));
        }
        assert.equal((await make([{media_type:'image',upload_id:foreign.id}])).code,'MEDIA_NOT_FOUND');
        const duplicates = await make([descriptor,descriptor]);
        assert.equal(duplicates.ok,true);
        assert.equal((await one('SELECT count(*)::int n FROM public.social_post_media WHERE post_id=$1', [duplicates.post_id])).n,2);
        const key = randomUUID(), repeated = await Promise.all([make([descriptor],key),make([descriptor],key)]);
        assert.ok(repeated.every((result)=>result.ok === true));
        assert.equal(repeated.filter((result)=>result.idempotent === false).length,1);
        assert.equal(repeated[0].post_id,repeated[1].post_id);
    });
    it('browser roles cannot read upload metadata or call privileged upload RPCs', async () => {
        const acl = await one(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid = 'public.social_uploads'::regclass`);
        assert.equal(acl.relrowsecurity,true); assert.equal(acl.relforcerowsecurity,true);
        for (const role of ['anon','authenticated']) {
            assert.equal(await call("has_table_privilege($1,'public.social_uploads','SELECT')",[role]),false);
            assert.equal(await call("has_function_privilege($1,'public.complete_social_upload(text,uuid)','EXECUTE')",[role]),false);
        }
    });
});
