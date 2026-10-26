import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { editorServerRenderHandlers } from '../lib/editorServerRender.js';
const AUTH = '22222222-2222-4222-8222-222222222222', ID = '11111111-1111-4111-8111-111111111111';
const doc = () => ({ schema_version: 2, project_id: ID, brief: '', canvas: { aspect_ratio: '16:9', frame_rate: 30 },
    timeline: JSON.parse(readFileSync(new URL('./fixtures/editorServerRender/v2.json', import.meta.url))) });
const request = (body = { document: doc(), resolution: '1080p' }, headers = {}, method = 'POST') => new Request(`https://app.test/api/v1/editor/server-render/quote?job_id=${ID}`, {
    method, headers: { 'x-veyrnox-auth-id': AUTH, 'x-request-id': ID, 'content-type': 'application/json', 'idempotency-key': 'quote-attempt-1', ...headers },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
});
function world(options = {}) {
    const calls = []; let price = 1, job, debits = 0, launches = 0;
    const deps = {
        rpc: async (name, args) => {
            calls.push([name, args]);
            if (name === 'replay_server_render') return job ? { ok: true, ...job, idempotent: true } : null;
            if (name === 'consume_upload_request') return { ok: true };
            if (name === 'quote_server_render') return { credits: price, max_seconds: args.p_resolution === '720p' ? 300 : 120 };
            if (name === 'server_render_source') return { ok: true, r2_key: 'source', size_bytes: 10, mime_type: args.p_media_id.includes('2222') ? 'audio/wav' : 'video/mp4' };
            if (name === 'admit_server_render') {
                if (job) return { ok: true, ...job, idempotent: true };
                if (args.p_quoted_credits !== undefined && args.p_quoted_credits !== price) return { ok: false, code: 'PRICE_CHANGED' };
                debits++; job = { job_id: ID, state: 'SUBMITTED', credits: price }; return { ok: true, ...job };
            }
            if (name === 'get_user_job') return { ok: true, provider: 'concat-render', state: 'STORED', render_id: ID, credits: 1 };
            if (name === 'fail_server_render') return { ok: true, state: 'REFUNDED' };
            if (name === 'cleanup_server_render') return { ok: true };
            throw new Error(name);
        },
        signGet: async () => ({ url: 'https://r2.test/source' }),
        runner: { run: async () => { launches++; return { ok: true }; }, cancel: async () => {} },
    };
    return { deps, calls, handlers: editorServerRenderHandlers(deps, { mode: 'on', publicHost: 'https://app.test', ...options }),
        price: n => { price = n; }, counts: () => ({ debits, launches }) };
}
test('quote authenticates, enforces origin, and fails closed before an RPC', async () => {
    const w = world({ mode: 'off' });
    assert.equal((await w.handlers.quote(request())).status, 501);
    assert.equal((await w.handlers.quote(request(undefined, { 'x-veyrnox-auth-id': '' }))).status, 401);
    assert.equal((await w.handlers.quote(request(undefined, { origin: 'https://other.test' }))).status, 403);
    assert.deepEqual(w.calls, []);
});
test('preview requires a valid allowlisted auth UUID for quote AND create; on admits everyone', async () => {
    for (const secret of ['', undefined, ID, `${AUTH}suffix`, 'constructor']) {
        const w = world({ mode: 'preview', previewUserIds: secret });
        for (const action of ['quote', 'create']) {
            const r = await w.handlers[action](request());
            assert.equal(r.status, 403); assert.equal((await r.json()).error, 'preview_only');
        }
        assert.equal(w.calls.length, 0);
    }
    const w = world({ mode: 'preview', previewUserIds: `invalid, ${AUTH.toUpperCase()}, ${ID}` });
    assert.equal((await w.handlers.quote(request())).status, 200);
    assert.equal((await w.handlers.create(request({ document: doc(), resolution: '1080p', label: 'Edit', quoted_credits: 1 }))).status, 202);
    assert.equal((await world().handlers.quote(request())).status, 200);
});
test('existing-job reads and cancellation remain available with admission closed', async () => {
    for (const mode of ['off', 'preview']) {
        const w = world({ mode });
        const response = await w.handlers.status(request(undefined, {}, 'GET'));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { job_id: ID, state: 'succeeded', render_id: ID, credits: 1, refunded: false, output_type: 'editor-render' });
        assert.equal((await w.handlers.cancel(request(undefined, {}, 'DELETE'))).status, 200);
    }
});
test('quote validates the document and size, translates exact duration and consumes the existing rate limit', async () => {
    const w = world();
    for (const body of [{}, { document: doc(), resolution: '360p' }, { document: {}, resolution: '720p' },
        { document: doc(), resolution: '1080p', seconds: 1 }]) assert.equal((await w.handlers.quote(request(body))).status, 400);
    const unsupported = doc(); unsupported.timeline.video[0].transitionType = 'wipe';
    assert.equal((await (await w.handlers.quote(request({ document: unsupported, resolution: '1080p' }))).json()).error, 'editor_render_unsupported');
    assert.equal(w.calls.length, 0);
    for (const resolution of ['720p', '1080p']) {
        for (const frames of [300, 301]) {
            const document = doc(); document.timeline.video = [{ ...document.timeline.video[0], in: 0, len: frames, transition: 0 }]; document.timeline.audio = []; document.timeline.text = [];
            document.timeline.media[document.timeline.video[0].mediaId].frames = 400;
            const r = await w.handlers.quote(request({ document, resolution }));
            assert.equal(r.status, 200);
            assert.deepEqual(await r.json(), { credits: 1, seconds: frames / 30, resolution, max_seconds: resolution === '720p' ? 300 : 120 });
            assert.equal(w.calls.at(-1)[1].p_seconds, frames / 30);
        }
    }
    assert.ok(w.calls.every(([name]) => ['consume_upload_request', 'quote_server_render'].includes(name)));
    w.deps.rpc = async () => ({ ok: false });
    assert.equal((await w.handlers.quote(request())).status, 429);
});
test('price_changed passes consent straight to atomic admit, with no quote RPC and no launch', async () => {
    const w = world(); w.price(2);
    const r = await w.handlers.create(request({ document: doc(), resolution: '1080p', label: 'Edit', quoted_credits: 1 }));
    assert.equal(r.status, 409); assert.equal((await r.json()).error, 'price_changed');
    assert.deepEqual(w.counts(), { debits: 0, launches: 0 });
    assert.equal(w.calls.at(-1)[1].p_quoted_credits, 1);
    assert.ok(w.calls.every(([name]) => name !== 'quote_server_render'));
    for (const value of [null, -1, 0, 1.1, '1', 2147483648]) assert.equal((await w.handlers.create(request({ document: doc(), label: 'Edit', quoted_credits: value }))).status, 400);
});
test('lost-response retry after catalog change replays original credits with one debit and runner launch', async () => {
    const w = world(), body = { document: doc(), resolution: '1080p', label: 'Edit', quoted_credits: 1 };
    assert.equal((await w.handlers.create(request(body))).status, 202); // response lost by the client
    w.price(9);
    const retry = await w.handlers.create(request(body));
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), { job_id: ID, state: 'SUBMITTED', credits: 1, idempotent: true });
    assert.deepEqual(w.counts(), { debits: 1, launches: 1 });
});
