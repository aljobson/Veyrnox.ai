import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const url = new URL(process.env.DATABASE_URL || '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname)) throw new Error('Editor render tests require a disposable local test database');
const db = new pg.Client({ connectionString: url.href }); await db.connect();
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const admin = () => db.query('RESET ROLE');
const actor = async id => { await admin(); await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [id || '']); await db.query('SET LOCAL ROLE authenticated'); };
const reject = async (sql, args, code) => { await db.query('SAVEPOINT expected_failure'); try { await assert.rejects(db.query(sql, args), e => e.code === code); } finally { await db.query('ROLLBACK TO SAVEPOINT expected_failure'); } };
let count = 0; const check = async (name, run) => { await run(); console.log(`ok ${++count} - ${name}`); };
const reserve = (label, hash, size, consent, key) => scalar('SELECT public.reserve_editor_library_render($1,$2,$3,$4,$5)', [label, hash, size, consent, key]);
const keyFor = (owner, id) => `editor-renders/${owner}/${id}.mp4`;
try {
    await db.query('BEGIN'); await db.query('GRANT USAGE ON SCHEMA auth TO authenticated');
    const owner = randomUUID(), outsider = randomUUID(), orphan = randomUUID();
    for (const id of [owner, outsider, orphan]) await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [id, `editor-render-${id}@example.invalid`]);
    await actor(owner);
    let first;
    await check('caller-JWT reservation pins owner, key and bytes; idempotent replay and payload conflicts are enforced', async () => {
        first = await reserve('Original local edit', 'a'.repeat(64), 1000, true, 'same-local-edit-save');
        assert.equal(first.state, 'quarantined'); assert.equal(first.r2_key, keyFor(owner, first.id));
        const replay = await reserve('Original local edit', 'a'.repeat(64), 1000, true, 'same-local-edit-save'); assert.equal(replay.id, first.id); assert.equal(replay.idempotent, true);
        await reject('SELECT public.reserve_editor_library_render($1,$2,$3,true,$4)', ['Other payload', 'a'.repeat(64), 1000, 'same-local-edit-save'], 'PT409');
        assert.equal((await scalar('SELECT public.read_editor_library_renders()')).renders.length, 0);
    });
    await check('raw browser writes, privileged inspection and anonymous RPCs remain forbidden', async () => {
        await reject("UPDATE public.editor_library_renders SET state='stored' WHERE id=$1", [first.id], '42501');
        await reject('DELETE FROM public.editor_library_renders WHERE id=$1', [first.id], '42501');
        await reject('SELECT public.record_editor_render_inspection($1,$2,1000,640,360,1,30)', [first.id, 'a'.repeat(64)], '42501');
        await admin();
        for (const signature of ['public.reserve_editor_library_render(text,text,bigint,boolean,text)', 'private.reserve_editor_library_render(text,text,bigint,boolean,text)', 'public.read_editor_library_renders(uuid)', 'public.remove_editor_library_render(uuid)']) {
            assert.equal(await scalar("SELECT has_function_privilege('anon',$1,'EXECUTE')", [signature]), false);
            assert.equal(await scalar("SELECT prosecdef FROM pg_proc WHERE oid=$1::regprocedure", [signature]), signature.startsWith('private.'));
        }
        assert.equal(await scalar("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.editor_library_renders'::regclass"), true); await actor(owner);
    });
    await check('an outsider cannot read, inspect or remove another actor’s render', async () => {
        await actor(outsider); assert.equal(Number(await scalar('SELECT count(*) FROM public.editor_library_renders WHERE id=$1', [first.id])), 0);
        assert.equal((await scalar('SELECT public.read_editor_library_renders($1)', [first.id])).renders.length, 0);
        await reject('SELECT public.remove_editor_library_render($1)', [first.id], 'PT404'); await actor(owner);
    });
    await check('only service inspection can settle matching immutable bytes; replay is safe and changed metadata fails', async () => {
        await admin(); await db.query('SET LOCAL ROLE service_role');
        await reject('SELECT public.record_editor_render_inspection($1,$2,999,640,360,1,30)', [first.id, 'a'.repeat(64)], 'PT400');
        const saved = await scalar('SELECT public.record_editor_render_inspection($1,$2,1000,640,360,1,30)', [first.id, 'a'.repeat(64)]); assert.equal(saved.state, 'stored');
        assert.equal((await scalar('SELECT public.record_editor_render_inspection($1,$2,1000,640,360,1,30)', [first.id, 'a'.repeat(64)])).idempotent, true);
        await reject('SELECT public.record_editor_render_inspection($1,$2,1000,1280,720,1,30)', [first.id, 'a'.repeat(64)], 'PT409');
        await actor(owner); const page = await scalar('SELECT public.read_editor_library_renders()'); assert.equal(page.renders.length, 1); assert.equal(page.renders[0].width, 640); assert.equal(page.renders[0].frame_rate, 30);
        assert.ok(!('request_key' in page.renders[0])); assert.ok(!('owner_id' in page.renders[0]));
    });
    await check('direct RPC validation refuses consent, malformed metadata, unsafe labels and oversize files', async () => {
        for (const args of [['Missing rights', 'a'.repeat(64), 1, false, randomUUID()], ['Bad hash', 'bad', 1, true, randomUUID()], ['Big', 'a'.repeat(64), 26214401, true, randomUUID()], ['Unsafe\x01', 'a'.repeat(64), 1, true, randomUUID()], ['No key', 'a'.repeat(64), 1, true, 'x']]) await reject('SELECT public.reserve_editor_library_render($1,$2,$3,$4,$5)', args, 'PT400');
    });
    await check('request throttling and 200-MiB quota apply, while matching idempotent replay survives rate limits', async () => {
        await admin(); const user = await scalar('SELECT id FROM public.users WHERE auth_id=$1', [owner]);
        await db.query('UPDATE public.upload_request_rate_limits SET request_count=60,window_started_at=now() WHERE user_id=$1', [user]); await actor(owner);
        await reject('SELECT public.reserve_editor_library_render($1,$2,1000,true,$3)', ['Rate limited', 'a'.repeat(64), randomUUID()], 'PT429');
        assert.equal((await reserve('Original local edit', 'a'.repeat(64), 1000, true, 'same-local-edit-save')).id, first.id);
        await admin(); await db.query('UPDATE public.upload_request_rate_limits SET request_count=1 WHERE user_id=$1', [user]);
        for (let i = 0; i < 8; i++) { const id = randomUUID(); await db.query('INSERT INTO public.editor_library_renders(id,owner_id,label,r2_key,sha256,size_bytes,request_key) VALUES($1,$2,$3,$4,$5,26214400,$6)', [id, owner, 'Quota fixture', keyFor(owner, id), 'b'.repeat(64), `quota-fixture-${i}`]); }
        await actor(owner); await reject('SELECT public.reserve_editor_library_render($1,$2,1,true,$3)', ['Over quota', 'a'.repeat(64), randomUUID()], 'PT429');
        await admin(); await db.query("DELETE FROM public.editor_library_renders WHERE owner_id=$1 AND request_key LIKE 'quota-fixture-%'", [owner]); await actor(owner);
    });
    await check('remove immediately revokes reads, is idempotent and delays object reaping beyond live PUT grants', async () => {
        const removed = await scalar('SELECT public.remove_editor_library_render($1)', [first.id]); assert.equal(removed.removed, true);
        assert.equal((await scalar('SELECT public.remove_editor_library_render($1)', [first.id])).idempotent, true);
        assert.equal(Number(await scalar('SELECT count(*) FROM public.editor_library_renders WHERE id=$1', [first.id])), 0);
        assert.equal((await scalar('SELECT public.read_editor_library_renders($1)', [first.id])).renders.length, 0);
        await reject('SELECT public.reserve_editor_library_render($1,$2,1000,true,$3)', ['Original local edit', 'a'.repeat(64), 'same-local-edit-save'], 'PT409');
        await admin(); assert.equal(await scalar("SELECT expires_at>=created_at+interval '16 minutes' FROM public.editor_library_renders WHERE id=$1", [first.id]), true);
        await scalar('SELECT public.expire_editor_library_renders(500)'); assert.equal(Number(await scalar('SELECT count(*) FROM public.asset_reap_queue WHERE r2_key=$1', [first.r2_key])), 0); await actor(owner);
    });
    await check('Auth deletion clears identity and safely schedules both quarantined and already removed rows', async () => {
        await actor(orphan); const pending = await reserve('Orphan pending', 'a'.repeat(64), 1, true, 'orphan-pending-save'); const removed = await reserve('Orphan removed', 'a'.repeat(64), 1, true, 'orphan-removed-save'); await scalar('SELECT public.remove_editor_library_render($1)', [removed.id]);
        await admin(); await db.query('DELETE FROM auth.users WHERE id=$1', [orphan]);
        for (const id of [pending.id, removed.id]) { const row = (await db.query('SELECT owner_id,state,expires_at>=created_at+interval \'16 minutes\' AS delayed FROM public.editor_library_renders WHERE id=$1', [id])).rows[0]; assert.equal(row.owner_id, null); assert.equal(row.state, 'removed'); assert.equal(row.delayed, true); }
        await actor(orphan); assert.equal((await scalar('SELECT public.read_editor_library_renders()')).renders.length, 0); await actor(owner);
    });
    await check('due quarantine and stored rows enter the existing bounded reap queue exactly once', async () => {
        await admin(); const expired = randomUUID(); await db.query("INSERT INTO public.editor_library_renders(id,owner_id,label,r2_key,sha256,size_bytes,request_key,created_at,expires_at) VALUES($1,$2,'Expired fixture',$3,$4,1,$5,now()-interval '25 hours',now()-interval '1 hour')", [expired, owner, keyFor(owner, expired), 'c'.repeat(64), randomUUID()]);
        assert.ok(await scalar('SELECT public.expire_editor_library_renders(500)') >= 1);
        assert.equal(Number(await scalar('SELECT count(*) FROM public.asset_reap_queue WHERE r2_key=$1', [keyFor(owner, expired)])), 1); await scalar('SELECT public.expire_editor_library_renders(500)');
        assert.equal(Number(await scalar('SELECT count(*) FROM public.asset_reap_queue WHERE r2_key=$1', [keyFor(owner, expired)])), 1);
        assert.equal(await scalar("SELECT count(*)=1 FROM cron.job WHERE jobname='veyrnox-expire-editor-renders' AND schedule='*/15 * * * *' AND command LIKE '%public.expire_editor_library_renders(100)%'"), true);
    });
    console.log(`Editor private Library: ${count} security/storage checks passed.`);
} finally { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
