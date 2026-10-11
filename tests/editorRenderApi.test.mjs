import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { editorRenderHandlers } from '../lib/editorRenderApi.js';
import { inspectEditorRender } from '../lib/editorRenderInspection.js';
import { sha256Hex } from '../packages/adapters/r2.js';
const actor = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
const bytes = new Uint8Array(await readFile(new URL('./fixtures/editor-render-360p30.mp4', import.meta.url))), hash = await sha256Hex(bytes);
const now = Date.parse('2026-10-11T12:00:00Z'), key = `editor-renders/${actor}/${id}.mp4`;
const cfg = { supabaseUrl: 'https://database.test', serviceRoleKey: 'private-service-key' }, r2cfg = { accountId: 'test', accessKeyId: 'test', secretAccessKey: 'test', bucket: 'test' };
Object.assign(process.env, { APP_ENV: 'development', PUBLIC_HOST: 'http://localhost:3000', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_test', SUPABASE_URL: 'http://127.0.0.1:54321', TENANT_PROJECTS_ENABLED: 'false' });
const body = { label: 'Local edit.mp4', sha256: hash, size_bytes: bytes.length, rights_confirmed: true };
const request = (method = 'GET', data, identity = actor, query = '') => new Request(`http://localhost:3000/api/v1/library/editor-renders${query}`, { method, headers: { ...(identity ? { 'x-veyrnox-auth-id': identity, 'x-request-id': crypto.randomUUID() } : {}), authorization: 'Bearer caller-only-token', 'content-type': 'application/json', 'idempotency-key': 'editor-save-request' }, ...(data ? { body: JSON.stringify(data) } : {}) });
function setup(change = {}) {
    const calls = [], reads = [], signs = [], row = { id, label: body.label, r2_key: key, state: 'quarantined', created_at: new Date(now).toISOString(), expires_at: new Date(now + 86400000).toISOString(), sha256: hash, size_bytes: bytes.length, ...change.row };
    const handler = editorRenderHandlers({ enabled: true, cfg, r2cfg, now: () => now,
        tenant: async (req, context, path, init) => { reads.push({ path, init }); assert.equal(req.headers.get('authorization'), 'Bearer caller-only-token'); assert.equal(context.userId, actor); assert.ok(!JSON.stringify(init).includes('private-service-key')); if (change.tenant) return change.tenant(path, init); return path.includes('reserve') ? row : { renders: [row] }; },
        call: async (name, args) => { calls.push({ name, args }); if (name === 'consume_upload_request') return change.limited ? { ok: false } : { ok: true }; assert.equal(name, 'record_editor_render_inspection'); assert.deepEqual(args, { p_id: id, p_sha256: hash, p_size_bytes: bytes.length, p_width: 640, p_height: 360, p_seconds: 1, p_frame_rate: 30 }); return { id, state: 'stored' }; },
        signPut: async (...args) => { signs.push(args); return { url: 'https://storage.test/signed-put', headers: { 'Content-Type': 'video/mp4', 'If-None-Match': '*' } }; },
        signGet: async (...args) => { signs.push(args); return { url: 'https://storage.test/signed-get', expires: 900 }; },
        get: async actualKey => { assert.equal(actualKey, key); return { ok: true, response: new Response(change.bytes || bytes, { headers: { 'content-type': 'video/mp4', 'content-length': String(change.length || bytes.length) } }) }; },
        ...change.handler,
    });
    return { ...handler, calls, reads, signs, row };
}

test('actual non-Film MP4 packets establish dimensions, duration and 30 fps; malformed/forged metadata fails', async () => {
    assert.deepEqual(await inspectEditorRender(bytes), { width: 640, height: 360, seconds: 1, frame_rate: 30 });
    for (const bad of [bytes.subarray(0, 100), new Uint8Array([1, 2, 3])]) assert.equal(await inspectEditorRender(bad), null);
    const dimensions = bytes.slice(), at = Buffer.from(dimensions).indexOf('tkhd'); new DataView(dimensions.buffer).setUint32(at + 80, 8192 * 65536); assert.equal(await inspectEditorRender(dimensions), null);
    const timing = bytes.slice(), stts = Buffer.from(timing).indexOf('stts'); new DataView(timing.buffer).setUint32(stts + 16, 1); assert.equal(await inspectEditorRender(timing), null);
});
test('render routes require middleware identity and their own flag, independently of cloud project rollout', async () => {
    assert.equal((await setup().reserve(request('POST', body, null))).status, 401);
    const h = setup({ handler: { enabled: false } }); assert.equal((await h.list(request())).status, 404); assert.equal(h.reads.length, 0);
    const ready = setup(); assert.equal((await ready.list(request())).status, 200); assert.equal(process.env.TENANT_PROJECTS_ENABLED, 'false');
    const denied = request(); denied.headers.set('origin', 'https://foreign.test'); assert.equal((await ready.list(denied)).status, 403);
});
test('reservation forwards only validated caller payload and signs an immutable bounded upload', async () => {
    const h = setup(), response = await h.reserve(request('POST', body)); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const result = await response.json(); assert.equal(result.id, id); assert.equal(result.headers['If-None-Match'], '*'); assert.ok(!('r2_key' in result));
    assert.deepEqual(h.reads[0].init.body, { p_label: body.label, p_sha256: hash, p_size_bytes: bytes.length, p_rights_confirmed: true, p_idempotency_key: 'editor-save-request' });
    assert.deepEqual(h.signs[0].slice(0, 3), [key, 'video/mp4', 900]); assert.equal(h.signs[0][4], bytes.length);
    for (const bad of [{ rights_confirmed: false }, { owner_id: actor }, { size_bytes: 26214401 }, { sha256: 'x' }, { label: 'unsafe\u0001' }]) assert.equal((await h.reserve(request('POST', { ...body, ...bad }))).status, 400);
    assert.equal(h.reads.length, 1);
});
test('owned bytes are fully hashed and packet-inspected before privileged settlement; no social or ledger write occurs', async () => {
    const h = setup(); assert.equal((await h.inspectSaved(request('POST'), id)).status, 200);
    assert.deepEqual(h.calls.map(c => c.name), ['consume_upload_request', 'record_editor_render_inspection']);
    const limit = setup({ limited: true }); assert.equal((await limit.inspectSaved(request('POST'), id)).status, 429); assert.equal(limit.calls.length, 1);
    const wrong = bytes.slice(); wrong[wrong.length - 1] ^= 1;
    for (const change of [{ bytes: wrong }, { bytes: bytes.subarray(0, 100) }, { length: bytes.length + 1 }]) { const bad = setup(change); assert.ok((await bad.inspectSaved(request('POST'), id)).status >= 400); assert.equal(bad.calls.some(c => c.name === 'record_editor_render_inspection'), false); }
    const other = setup({ tenant: () => ({ renders: [] }) }); assert.equal((await other.inspectSaved(request('POST'), id)).status, 404); assert.equal(other.calls.length, 0);
});
test('readbacks omit internal keys and only inspected owned videos get short-lived downloads', async () => {
    const quarantined = setup(); assert.equal((await quarantined.asset(request(), id)).status, 404); assert.equal(quarantined.signs.length, 0);
    const stored = setup({ row: { state: 'stored', owner_id: actor, request_key: 'private-key' } });
    const page = await (await stored.list(request())).json(); assert.equal(page.renders[0].id, id); for (const field of ['r2_key', 'owner_id', 'request_key']) assert.ok(!(field in page.renders[0]));
    assert.equal((await stored.asset(request('GET', null, actor, '?download=1'), id)).status, 200); assert.equal(stored.signs[0][1], 900); assert.match(stored.signs[0][3].downloadFilename, /\.mp4$/);
    assert.equal((await stored.asset(request('GET', null, actor, '?download=0'), id)).status, 400);
    assert.equal((await stored.asset(request('GET', null, actor, '?download=1&download=1'), id)).status, 400);
});
test('caller-JWT adapter sends no service key and bounds safe upstream error projection', async () => {
    const original = globalThis.fetch; let outbound;
    globalThis.fetch = async (url, init) => { outbound = { url: String(url), init }; return Response.json({ private: 'SQL secret path' }, { status: 403 }); };
    try { const response = await editorRenderHandlers({ enabled: true, cfg, r2cfg }).list(request()); assert.equal(response.status, 403); assert.ok(!(await response.text()).includes('SQL secret')); assert.equal(outbound.init.headers.authorization, 'Bearer caller-only-token'); assert.equal(outbound.init.redirect, 'manual'); assert.ok(!JSON.stringify(outbound).includes(cfg.serviceRoleKey)); } finally { globalThis.fetch = original; }
});
