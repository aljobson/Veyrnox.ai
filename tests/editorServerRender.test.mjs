import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { editorServerRenderHandlers, finalizeUploadedRender } from '../lib/editorServerRender.js';
import { editorServerRenderWebhook } from '../lib/editorServerRenderWebhook.js';
import { sweepEditorServerRender } from '../lib/editorServerRenderSweep.js';
import { signRunnerBody } from '../lib/montageSigning.js';
import { presignPutUrl } from '../packages/adapters/r2.js';
import { runnerHandler, uploadRenderedFile } from '../services/concat-render/runner.mjs';
import { editorServerRenderDeps } from '../lib/editorServerRenderRuntime.js';
import { editorFeatureEnabled } from '../lib/editorRuntimeFlags.mjs';
import { observeRecovery } from '../lib/recoveryHealth.js';
import { sweepSteps } from '../lib/autoShortSweep.js';
import { sweepMontage } from '../lib/montageSweep.js';

const ID = '11111111-1111-4111-8111-111111111111', AUTH = '22222222-2222-4222-8222-222222222222';
const secret = 'unit-test-signing-secret';
const doc = () => ({ schema_version: 2, project_id: ID, brief: '', canvas: { aspect_ratio: '16:9', frame_rate: 30 }, timeline: JSON.parse(readFileSync(new URL('./fixtures/editorServerRender/v2.json', import.meta.url))) });
const request = (body = { document: doc(), label: 'Edit', resolution: '1080p' }, method = 'POST') => new Request(`https://app.test/api/v1/editor/server-render?job_id=${ID}`, {
    method, headers: { 'content-type': 'application/json', 'x-veyrnox-auth-id': AUTH, 'x-request-id': ID, 'idempotency-key': 'render-test-1' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
});
async function signed(body, signature = true) {
    const raw = JSON.stringify({ job_id: ID, ...body }), t = Math.floor(Date.now() / 1000);
    return new Request('https://app.test/api/webhook/editor-render', { method: 'POST', headers: {
        'x-runner-timestamp': String(t), 'x-runner-signature': signature ? await signRunnerBody(secret, raw, t) : 'bad',
    }, body: raw });
}
function world() {
    let job = null, debits = 0, refunds = 0, launches = 0, grants = 0;
    const seen = new Set(), calls = [];
    const deps = { secret, signGet: async () => ({ url: 'https://r2.test/source' }), job: async () => structuredClone(job), jobs: async () => job ? [structuredClone(job)] : [],
        runner: { run: async () => { launches++; return { ok: true }; }, cancel: async () => {}, states: async () => ({ ok: true, data: { runs: { [ID]: 'running' } } }) },
        dedup: async id => seen.has(id) ? 'duplicate' : 'new', processed: async id => seen.add(id),
        signPut: async (key, size) => { grants++; return presignPutUrl(key, 'video/mp4', 900, { accountId: 'a', accessKeyId: 'b', secretAccessKey: 'c', bucket: 'd' }, size); },
        get: async () => ({ ok: true, response: new Response(new Uint8Array(10), { headers: { 'content-length': '10', 'content-type': 'video/mp4' } }) }),
        readBytes: async body => new Uint8Array(await new Response(body).arrayBuffer()), sha256: async () => 'a'.repeat(64),
        inspect: async () => ({ width: 1920, height: 1080, seconds: 5, frame_rate: 30 }),
        rpc: async (name, a) => {
            calls.push([name, a]);
            if (name === 'consume_upload_request') return { ok: true };
            if (name === 'server_render_source') return { ok: true, r2_key: 'source', size_bytes: 10, mime_type: a.p_media_id.includes('2222') ? 'audio/wav' : 'video/mp4' };
            if (name === 'admit_server_render') {
                if (job) return { ok: true, idempotent: true, job_id: ID, state: job.state, credits: 10 };
                debits++; job = { id: ID, user_id: AUTH, provider: 'concat-render', state: 'SUBMITTED', credits: 10, created_at: new Date().toISOString(), inputs: {
                    document: a.p_document, resolution: a.p_resolution, seconds: a.p_seconds, output_key: `editor-renders/${AUTH}/${ID}.mp4`,
                } }; return { ok: true, job_id: ID, credits: 10 };
            }
            if (name === 'get_user_job') return { ok: true, ...job };
            if (name === 'server_render_upload_grant') {
                if (job.state !== 'SUBMITTED') return { ok: false };
                job.inputs.upload_size = a.p_size; return { ok: true, r2_key: job.inputs.output_key, size_bytes: a.p_size };
            }
            if (name === 'fail_server_render') { if (job.state !== 'STORED' && job.state !== 'REFUNDED') { refunds++; job.state = 'REFUNDED'; } return { ok: true, state: job.state }; }
            if (name === 'finalize_server_render') { if (job.state !== 'SUBMITTED') return { ok: false }; job.state = 'STORED'; return { ok: true }; }
            if (name === 'cleanup_server_render') return true;
            throw new Error(name);
        },
    };
    const handlers = editorServerRenderHandlers(deps, { enabled: true, publicHost: 'https://app.test' });
    return { deps, handlers, calls, job: () => job, counts: () => ({ debits, refunds, launches, grants }) };
}
test('flag off and inactive catalog return 501; unauthenticated requests return 401', async () => {
    const w = world();
    assert.equal((await editorServerRenderHandlers(w.deps).create(request())).status, 501);
    assert.equal((await w.handlers.create(new Request('https://app.test'))).status, 401);
    const rpc = w.deps.rpc; w.deps.rpc = (name, a) => name === 'admit_server_render' ? { ok: false, code: 'NOT_ENABLED' } : rpc(name, a);
    assert.equal((await w.handlers.create(request())).status, 501);
    assert.equal(w.counts().debits, 0);
});
test('create replay launches and debits once; unsupported edits and cross-user sources never debit', async () => {
    const w = world();
    assert.equal((await w.handlers.create(request())).status, 202);
    assert.equal((await w.handlers.create(request())).status, 200);
    assert.deepEqual(w.counts(), { debits: 1, refunds: 0, launches: 1, grants: 0 });
    const bad = doc(); bad.timeline.text[0].x = .2;
    assert.equal((await w.handlers.create(request({ document: bad, label: 'Edit' }))).status, 400);
    const v = world(); v.deps.rpc = async name => name === 'consume_upload_request' ? { ok: true } : { ok: false, code: 'NOT_FOUND' };
    assert.equal((await v.handlers.create(request())).status, 403);
    assert.equal(v.counts().debits, 0);
});
test('flag off leaves status, cancel and callbacks available; refunded replay requires a new key', async () => {
    const w = world(); await w.handlers.create(request());
    const off = editorServerRenderHandlers(w.deps, { enabled: false });
    assert.equal((await off.status(request(undefined, 'GET'))).status, 200);
    assert.equal((await off.cancel(request(undefined, 'DELETE'))).status, 200);
    assert.equal(w.job().state, 'REFUNDED');
    const replay = await w.handlers.create(request());
    assert.equal(replay.status, 409);
    assert.deepEqual(await replay.json(), { job_id: ID, state: 'REFUNDED', credits: 10, idempotent: true, ok: false, error: 'render_refunded', retry_with_new_key: true });
    assert.equal(w.counts().launches, 1);
    const v = world(); await v.handlers.create(request()); v.job().inputs.upload_size = 10;
    assert.equal((await editorServerRenderWebhook(v.deps)(await signed({ event: 'done' }))).status, 200);
    assert.equal(v.job().state, 'STORED');
});
test('upload reservations must have matching stored bytes before debit; held sources get no URL', async () => {
    const d = doc(), old = d.timeline.video[0].mediaId, upload = `u-${ID}`;
    d.timeline.media[upload] = { ...d.timeline.media[old], id: upload };
    delete d.timeline.media[old];
    for (const clip of d.timeline.video) if (clip.mediaId === old) clip.mediaId = upload;
    for (const object of [null, { size: 9, type: 'video/mp4' }, { size: 10, type: 'audio/wav' }, { size: 10, type: 'video/mp4' }]) {
        const w = world();
        w.deps.get = async () => object ? { ok: true, response: new Response(new Uint8Array(object.size), { headers: { 'content-length': String(object.size), 'content-type': object.type } }) } : { ok: false };
        const result = await w.handlers.create(request({ document: d, label: 'Upload' }));
        const complete = object?.size === 10 && object.type === 'video/mp4';
        assert.equal(result.status, complete ? 202 : 409);
        assert.equal(w.counts().debits, complete ? 1 : 0);
    }
    const w = world(), rpc = w.deps.rpc;
    let urls = 0;
    w.deps.signGet = async () => { urls++; };
    w.deps.rpc = (name, args) => name === 'server_render_source' ? { ok: false, code: 'NOT_FOUND' } : rpc(name, args);
    assert.equal((await w.handlers.create(request({ document: d, label: 'Held upload' }))).status, 403);
    assert.equal(urls, 0); assert.equal(w.counts().debits, 0);
});
test('a full cleanup backlog cannot crowd live jobs out of recovery', async () => {
    const old = globalThis.fetch, queries = [];
    globalThis.fetch = async input => {
        const url = new URL(input); queries.push(url);
        return Response.json(url.searchParams.get('state') === 'eq.REFUNDED'
            ? Array.from({ length: 25 }, (_, i) => ({ id: `closed-${i}`, state: 'REFUNDED' }))
            : [{ id: ID, state: 'SUBMITTED' }]);
    };
    try {
        const deps = editorServerRenderDeps({ env: {}, cfg: { supabaseUrl: 'https://db.test', serviceRoleKey: 'test' }, r2cfg: {} });
        const jobs = await deps.jobs();
        assert.equal(jobs[0].id, ID); assert.equal(jobs.length, 26);
        assert.equal(queries.length, 2);
        const cleanup = queries.find(u => u.searchParams.get('state') === 'eq.REFUNDED');
        assert.equal(cleanup.searchParams.get('inputs->>cleanup_skipped'), 'is.null');
        assert.equal(cleanup.searchParams.get('deleted_at'), 'is.null');
        assert.equal(cleanup.searchParams.get('limit'), '25');
    } finally { globalThis.fetch = old; }
});
test('admission rollback leaves independently enabled recovery and its heartbeat working', async () => {
    const w = world(); await w.handlers.create(request());
    w.job().created_at = new Date(Date.now() - 46 * 60000).toISOString();
    const env = { EDITOR_RUNTIME_FLAGS: '{"serverRender":"false","serverRenderRecovery":"true"}', RECOVERY_HEALTH_ENABLED: 'true' };
    assert.equal((await editorServerRenderHandlers(w.deps, { enabled: editorFeatureEnabled('EDITOR_SERVER_RENDER_ENABLED', env) }).create(request())).status, 501);
    const beats = [];
    await observeRecovery('editor_server_render', () => sweepEditorServerRender({ deps: w.deps,
        enabled: editorFeatureEnabled('EDITOR_SERVER_RENDER_RECOVERY_ENABLED', env) }), env, async (_name, args) => beats.push(args));
    assert.equal(w.job().state, 'REFUNDED');
    assert.deepEqual(beats, [{ p_task: 'editor_server_render', p_ok: true }]);
});
test('fresh upload grant works after 20 minutes, signs length and non-overwrite, refuses after cancel', async () => {
    const w = world(); await w.handlers.create(request()); w.job().created_at = new Date(Date.now() - 20 * 60000).toISOString();
    const hook = editorServerRenderWebhook(w.deps);
    const grant = await (await hook(await signed({ event: 'upload_grant', size_bytes: 10 }))).json();
    assert.equal(new URL(grant.upload_url).searchParams.get('X-Amz-Expires'), '900');
    assert.equal(new URL(grant.upload_url).searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host;if-none-match');
    assert.equal(grant.headers['If-None-Match'], '*'); assert.equal(grant.headers['Content-Length'], '10');
    await w.handlers.cancel(request(undefined, 'DELETE'));
    assert.equal((await hook(await signed({ event: 'upload_grant', size_bytes: 10 }))).status, 409);
    assert.equal(w.counts().refunds, 1); assert.equal(w.counts().grants, 1);
});
test('done verifies stored bytes and ignores runner user/hash; callback replay is a no-op', async () => {
    const w = world(); await w.handlers.create(request()); const hook = editorServerRenderWebhook(w.deps);
    await hook(await signed({ event: 'upload_grant', size_bytes: 10 }));
    assert.equal((await hook(await signed({ event: 'done', user_id: 'attacker', sha256: 'b'.repeat(64) }))).status, 200);
    assert.equal((await hook(await signed({ event: 'done' }))).status, 200);
    assert.equal(w.calls.filter(([n]) => n === 'finalize_server_render').length, 1);
    assert.equal(w.calls.find(([n]) => n === 'finalize_server_render')[1].p_sha256, 'a'.repeat(64));
    assert.equal((await hook(await signed({ event: 'upload_grant', size_bytes: 10 }))).status, 409);
    assert.equal((await w.handlers.cancel(request(undefined, 'DELETE'))).status, 409);
    assert.equal(w.counts().refunds, 0);
});
test('bad signature is 401 before lookup; failed callbacks and cancel refund once', async () => {
    const w = world(); await w.handlers.create(request()); const hook = editorServerRenderWebhook(w.deps);
    assert.equal((await hook(await signed({ event: 'failed' }, false))).status, 401);
    await hook(await signed({ event: 'failed', error_code: 'runner_failed' }));
    await hook(await signed({ event: 'failed', error_code: 'runner_failed' }));
    await w.handlers.cancel(request(undefined, 'DELETE'));
    assert.equal(w.counts().refunds, 1);
});
test('runner submit failure and oversize output refund, and sweep recovers a lost callback', async () => {
    const w = world(); w.deps.runner.run = async () => ({ ok: false });
    assert.equal((await w.handlers.create(request())).status, 503); assert.equal(w.counts().refunds, 1);
    const v = world(); await v.handlers.create(request());
    assert.equal((await editorServerRenderWebhook(v.deps)(await signed({ event: 'upload_grant', size_bytes: 26214401 }))).status, 400);
    assert.equal(v.counts().refunds, 1);
    const r = world(); await r.handlers.create(request()); r.job().inputs.upload_size = 10;
    await sweepEditorServerRender({ deps: r.deps, enabled: true });
    assert.equal(r.job().state, 'STORED');
});
test('timeout, lost-run and cancel racing inspection cannot deliver after refund', async () => {
    const w = world(); await w.handlers.create(request()); w.job().created_at = new Date(Date.now() - 46 * 60000).toISOString();
    await sweepEditorServerRender({ deps: w.deps, enabled: true }); assert.equal(w.counts().refunds, 1);
    const v = world(); await v.handlers.create(request()); v.job().inputs.upload_size = 10;
    v.deps.inspect = async () => { await v.handlers.cancel(request(undefined, 'DELETE')); return { width: 1920, height: 1080, seconds: 5, frame_rate: 30 }; };
    assert.equal((await finalizeUploadedRender(structuredClone(v.job()), v.deps)).ok, false);
    assert.equal(v.job().state, 'REFUNDED');
    const r = world(); await r.handlers.create(request()); r.job().created_at = new Date(Date.now() - 5 * 60000).toISOString();
    r.deps.runner.states = async () => ({ ok: true, data: { runs: { [ID]: 'unknown' } } });
    await sweepEditorServerRender({ deps: r.deps, enabled: true }); assert.equal(r.counts().refunds, 1);
});
test('each sweep ignores the other orchestrators, and the editor sweep is off by default', async () => {
    const w = world(); await w.handlers.create(request());
    assert.deepEqual(await sweepEditorServerRender({ deps: w.deps }), { checked: 0, refunded: 0 });
    w.deps.jobs = async () => [{ ...w.job(), provider: 'montage' }, { ...w.job(), provider: 'kie' }];
    assert.equal((await sweepEditorServerRender({ deps: w.deps, enabled: true })).checked, 0);
    const old = globalThis.fetch;
    globalThis.fetch = async () => Response.json([{ provider: 'concat-render', state: 'SUBMITTED', updated_at: '2000-01-01' }]);
    try {
        const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'test' };
        assert.equal((await sweepSteps({ cfg, deps: {} })).checked, 0);
        assert.equal((await sweepMontage({ cfg, deps: {} })).checked, 0);
    } finally { globalThis.fetch = old; }
});
test('runner authenticates, admits one render, and suppresses replay', async () => {
    let release, executions = 0;
    const gate = new Promise(r => { release = r; });
    const handle = runnerHandler({ env: { EDITOR_RENDER_SIGNING_SECRET: secret, EDITOR_RENDER_CALLBACK_URL: 'https://app.test/callback' }, execute: async () => { executions++; await gate; } });
    const send = async id => { const r = await signed({ job_id: id, callback_url: 'https://app.test/callback', calls: [], sources: [] }); return handle('/run', new Uint8Array(await r.arrayBuffer()), r.headers); };
    try {
        assert.equal((await send(ID)).status, 202);
        assert.equal((await send(ID)).status, 200);
        assert.equal((await send(AUTH)).status, 429);
        assert.equal(executions, 1);
        assert.equal((await handle('/run', new Uint8Array(), new Headers())).status, 401);
    } finally { release(); }
});

test('an issued strict grant cannot replace bytes before or after finalization', async () => {
    const w = world(); await w.handlers.create(request());
    const hook = editorServerRenderWebhook(w.deps);
    const grant = await (await hook(await signed({ event: 'upload_grant', size_bytes: 10 }))).json();
    // S3's conditional-write contract: the signed precondition is required on
    // each PUT, including replay of a grant issued while the job was live.
    const objects = new Map();
    const put = bytes => {
        assert.equal(grant.headers['If-None-Match'], '*');
        if (objects.has(grant.upload_url)) return 412;
        objects.set(grant.upload_url, bytes); return 200;
    };
    assert.equal(put('original'), 200);
    assert.equal(put('replacement'), 412);
    await hook(await signed({ event: 'done' }));
    assert.equal(put('replacement after finalize'), 412);
    assert.equal(objects.get(grant.upload_url), 'original');
});
test('PUT reply loss retries with a fresh stream; 412 delegates success or refund to Worker inspection', async () => {
    const output = fileURLToPath(new URL('./fixtures/editorServerRender/v2.json', import.meta.url));
    for (const valid of [true, false]) {
        const w = world(); await w.handlers.create(request()); w.job().inputs.upload_size = 10;
        if (!valid) w.deps.inspect = async () => null;
        const hook = editorServerRenderWebhook(w.deps), bodies = [], events = [];
        await uploadRenderedFile(output, { upload_url: 'https://r2.test/output', headers: { 'If-None-Match': '*' } }, {
            signal: new AbortController().signal, wait: async () => {},
            fetchImpl: async (_url, init) => {
                const chunks = []; for await (const chunk of init.body) chunks.push(chunk);
                bodies.push(Buffer.concat(chunks));
                if (bodies.length === 1) throw new TypeError('network reply lost after storing bytes');
                return new Response(null, { status: 412 });
            },
            callback: async payload => { events.push(payload.event); return (await hook(await signed(payload))).json(); },
        });
        assert.equal(bodies.length, 2); assert.deepEqual(bodies[0], bodies[1]);
        assert.deepEqual(events, ['done']);
        assert.equal(w.job().state, valid ? 'STORED' : 'REFUNDED');
        assert.equal(w.counts().refunds, valid ? 0 : 1);
    }
});
test('persistent upload network errors exhaust bounded retries before failure', async () => {
    let attempts = 0, callbacks = 0;
    await assert.rejects(uploadRenderedFile(fileURLToPath(new URL('./fixtures/editorServerRender/v2.json', import.meta.url)), { upload_url: 'https://r2.test/output', headers: {} }, {
        signal: new AbortController().signal, wait: async () => {}, callback: async () => { callbacks++; },
        fetchImpl: async (_url, init) => { for await (const _chunk of init.body) { /* Consume this attempt. */ } attempts++; throw new Error('offline'); },
    }), /offline/);
    assert.equal(attempts, 3); assert.equal(callbacks, 0);
});
test('malformed timeline collections fail before storage or debit', async () => {
    const w = world(), d = doc(); d.timeline.video = {};
    assert.equal((await w.handlers.create(request({ document: d, label: 'Edit' }))).status, 400);
    assert.equal(w.calls.length, 0);
});

test('Library delivery issues no URL when SQL authorization hides a preserved render', async () => {
    const { editorRenderHandlers } = await import('../lib/editorRenderApi.js');
    const config = { APP_ENV: 'development', PUBLIC_HOST: 'http://localhost:3000', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_test', SUPABASE_URL: 'http://127.0.0.1:54321' };
    const previous = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
    Object.assign(process.env, config);
    let signed = 0;
    try {
        const handlers = editorRenderHandlers({ enabled: true, tenant: async () => ({ renders: [] }), signGet: async () => { signed++; },
            r2cfg: { accountId: 'a', accessKeyId: 'b', secretAccessKey: 'c', bucket: 'd' } });
        assert.equal((await handlers.asset(request(undefined, 'GET'), ID)).status, 404);
        assert.equal(signed, 0);
    } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
test('call-plan references resolve only from local imports and Concat-created IDs', async () => {
    const { executeCalls } = await import('../services/concat-render/rpc.mjs');
    const { translateEditorRender } = await import('../lib/editorServerRenderTranslate.js');
    const calls = [], tl = doc().timeline;
    const rpc = { outcome: Promise.resolve(), call: async (method, params) => {
        calls.push({ method, params });
        if (method === 'project.create') return { project: { activeTimelineId: 'timeline', timelines: [{ id: 'timeline', tracks: [{ id: 'video' }, { id: 'text' }, { id: 'audio' }] }] } };
        return { createdId: `created-${calls.length}` };
    } };
    await executeCalls(translateEditorRender(tl).calls, rpc, { location: '/scratch', output: '/scratch/output.mp4', files: Object.fromEntries(Object.keys(tl.media).map(id => [id, `/scratch/${id}`])) });
    assert.equal(calls[1].params.file, `/scratch/${Object.keys(tl.media)[0]}`);
    assert.equal(calls.find(c => c.params.command?.op === 'addClip').params.command.mediaId, 'created-2');
    assert.equal(calls.at(-1).params.output, '/scratch/output.mp4');
    assert.equal(JSON.stringify(calls).includes('$ref'), false);
});
