import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { editorServerRenderHandlers } from '../../lib/editorServerRender.js';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

export async function uploadDatabaseTests(t, { query, json, authId, userId }) {
    const migration = readFileSync(new URL('../../packages/db/schema/supabase/0401_editor_server_render_uploads.sql', import.meta.url), 'utf8');
    await t.test('upload migration replays and replay lookup is service-role-only', async () => {
        await query(migration); await query(migration);
        for (const signature of ['public.check_upload_batch_budget(text,jsonb,integer,bigint)', 'public.replay_server_render(text,text,jsonb,text,numeric,text)', 'private.server_render_identity(jsonb)']) {
            assert.equal(await query(`SELECT NOT EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='${signature}'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE');`), 't');
            for (const role of ['anon', 'authenticated', 'service_role']) assert.equal(await query(`SELECT has_function_privilege('${role}','${signature}','EXECUTE');`), role === 'service_role' ? 't' : 'f');
            assert.equal(await query(`SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='${signature}'::regprocedure;`), 't');
        }
    });
    await t.test('real reservation passes SQL source and route byte checks; expired swept replay has one debit', async () => {
        const id = '44444444-4444-4444-8444-444444444444', key = `uploads/${authId}/${id}.mp4`;
        assert.equal((await json(`SELECT public.reserve_upload('${authId}',${quote(key)},16,'[]');`)).ok, true);
        assert.equal((await json(`SELECT public.check_upload_batch_budget('${authId}','[]',10,1);`)).code, 'UPLOAD_BUDGET_EXCEEDED');
        assert.equal((await json(`SELECT public.check_upload_batch_budget('${authId}','[]',1,209715200);`)).code, 'UPLOAD_BUDGET_EXCEEDED');
        assert.equal((await json(`SELECT public.check_upload_batch_budget('${authId}','[]',1,16);`)).ok, true);
        const timeline = JSON.parse(readFileSync(new URL('../fixtures/editorServerRender/v2.json', import.meta.url), 'utf8'));
        const original = timeline.video[0].mediaId;
        timeline.media = { [`u-${id}`]: { ...timeline.media[original], id: `u-${id}` } };
        timeline.video.forEach(c => { c.mediaId = `u-${id}`; }); timeline.audio = [];
        const document = { schema_version: 2, project_id: id, brief: '', canvas: { aspect_ratio: '16:9', frame_rate: 30 }, timeline };
        let present = true, signed = 0;
        const deps = { rpc: (name, args) => json(`SELECT coalesce(public.${name}(${Object.entries(args).map(([k, v]) => `${k} => ${typeof v === 'number' ? v : quote(typeof v === 'object' ? JSON.stringify(v) : v)}`).join(',')}),'null'::jsonb);`),
            get: async () => present ? { ok: true, response: new Response(new TextEncoder().encode('0123ftypisom0000'), { headers: { 'content-type': 'video/mp4', 'content-length': '16' } }) } : { ok: false },
            signGet: async () => { signed++; return { url: 'https://r2.test/source' }; }, runner: { run: async () => ({ ok: true }) } };
        const handlers = editorServerRenderHandlers(deps, { enabled: true });
        const request = (doc = document) => new Request('https://app.test/api/v1/editor/server-render', { method: 'POST', headers: {
            'x-veyrnox-auth-id': authId, 'x-request-id': id, 'idempotency-key': 'real-upload-replay', 'content-type': 'application/json',
        }, body: JSON.stringify({ document: doc, resolution: '1080p', label: 'Device export', quoted_credits: 1 }) });
        assert.equal((await json(`SELECT public.server_render_source('${authId}','u-${id}');`)).ok, true);
        const first = await handlers.create(request()); assert.equal(first.status, 202); const admitted = await first.json();
        await query(`UPDATE public.upload_reservations SET created_at=now()-interval '23 hours' WHERE r2_key=${quote(key)};`);
        assert.equal((await json(`SELECT public.server_render_source('${authId}','u-${id}');`)).ok, false, 'new admission keeps a one-hour render margin');
        await query(`UPDATE public.upload_reservations SET created_at=now()-interval '25 hours',put_expires_at=now()-interval '1 hour' WHERE r2_key=${quote(key)};`);
        present = false; // R2 sweep deleted bytes, then release removes the reservation.
        await query(`SELECT public.release_upload(${quote(key)});`);
        const replay = await handlers.create(request()); assert.equal(replay.status, 200);
        assert.deepEqual(await replay.json(), { ...admitted, idempotent: true }); assert.equal(signed, 1);
        assert.equal(await query(`SELECT count(*) FROM public.ledger_entries WHERE job_id='${admitted.job_id}' AND delta<0;`), '1');
        assert.equal((await handlers.create(request({ ...document, brief: 'different' }))).status, 403);
        const args = `${quote(JSON.stringify(document))},'1080p',4.5,'Device export'`;
        assert.equal(await json(`SELECT coalesce(public.replay_server_render('99999999-9999-4999-8999-999999999999','real-upload-replay',${args}),'null'::jsonb);`), null);
        await query(`SELECT public.fail_server_render('${admitted.job_id}','user_cancelled');`);
        assert.equal(await query(`SELECT count(*) FROM public.jobs WHERE user_id='${userId}' AND idempotency_key='real-upload-replay';`), '1');
    });
}
