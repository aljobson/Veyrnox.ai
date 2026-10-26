import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportDocument, localRenderFiles, pendingRenderFiles, remapRenderDocument, uploadRenderFiles,
    uploadedRenderAttempt, REUSE_MS } from '../app/veyrnox/_lib/editorServerRenderUploads.mjs';
import { renderSnapshot, sendRenderAttempt } from '../app/veyrnox/_lib/editorServerRenderClient.mjs';
import { editorServerRenderHandlers } from '../lib/editorServerRender.js';

const actor = '22222222-2222-4222-8222-222222222222', id = '11111111-1111-4111-8111-111111111111';
const tl = JSON.parse(readFileSync(new URL('./fixtures/editorServerRender/v2.json', import.meta.url)));
const doc = () => ({ schema_version: 2, project_id: id, brief: '', canvas: { aspect_ratio: '16:9', frame_rate: 30 }, timeline: structuredClone(tl) });
const blob = (type = 'video/mp4') => new Blob(['0123ftypisom0000'], { type });
function setup() {
    const document = doc();
    const local = remapRenderDocument(document, new Map([[`j-${id}`, 'local-1']]));
    const blobs = new Map([['local-1', blob()]]), cache = new Map();
    const files = localRenderFiles(local, blobs).files;
    let time = 100000, grants = 0, puts = 0, currentActor = actor;
    const options = { actor, getActor: () => currentActor, cache, consent: files.map(f => f.id), now: () => time,
        call: async () => {
            grants++;
            return { key: `uploads/${actor}/${String(grants).padStart(8, '0')}-1111-4111-8111-111111111111.mp4`,
                upload_url: 'https://r2.test/upload', headers: { 'Content-Length': '16', 'Content-Type': 'video/mp4', 'If-None-Match': '*' },
                content_type: 'video/mp4', expires_in: 900, reserved: true };
        }, transfer: async () => { puts++; return { ok: true }; } };
    return { local, blobs, files, cache, options, time: n => { time += n; }, switchAccount: () => { currentActor = 'other'; }, counts: () => ({ grants, puts }) };
}
test('export copy drops unused bin media; only used local files need upload; exact remap leaves original untouched', () => {
    const f = setup(), original = structuredClone(f.local);
    f.local.timeline.media.unused = { ...f.local.timeline.media['local-1'], id: 'unused' };
    const exported = exportDocument(f.local);
    assert.deepEqual(exported, original); assert.ok(f.local.timeline.media.unused);
    const classified = localRenderFiles(exported, f.blobs);
    assert.equal(classified.files.length, 1); assert.deepEqual(classified.errors, []);
    const remapped = remapRenderDocument(exported, new Map([['local-1', `u-${id}`]]));
    const expected = JSON.parse(JSON.stringify(exported).replaceAll('local-1', `u-${id}`));
    assert.deepEqual(remapped, expected); assert.deepEqual(exported, original);
    for (const prefix of ['j', 'e', 'f', 'u']) {
        assert.equal(localRenderFiles(remapRenderDocument(exported, new Map([['local-1', `${prefix}-${id}`]])), new Map()).files.length, 0);
    }
});
test('type, missing file, byte limits and ten-file cap fail the whole preflight', () => {
    const f = setup();
    for (const type of ['video/quicktime', 'video/webm', 'audio/mp4', 'image/png', '']) {
        assert.equal(localRenderFiles(f.local, new Map([['local-1', blob(type)]])).errors[0].code, 'localType');
    }
    assert.equal(localRenderFiles(f.local).errors[0].code, 'localMissing');
    for (const [type, cap] of [['video/mp4', 100], ['audio/mpeg', 20], ['audio/wav', 20]]) {
        assert.equal(localRenderFiles(f.local, new Map([['local-1', { type, size: cap * 1024 ** 2 }]])).errors.length, 0);
        assert.equal(localRenderFiles(f.local, new Map([['local-1', { type, size: cap * 1024 ** 2 + 1 }]])).errors[0].code, 'localSize');
    }
    const many = doc(), blobs = new Map(); many.timeline.media = {};
    for (let n = 0; n < 11; n++) { many.timeline.media[n] = { id: String(n) }; blobs.set(String(n), blob()); }
    assert.equal(localRenderFiles(many, blobs).errors[0].code, 'localCount');
});
test('complete signed headers and unchanged Blob; lost success then 412 retains original grant', async () => {
    const f = setup(); let tries = 0;
    f.options.transfer = async (_, init) => {
        assert.deepEqual(init.headers, { 'Content-Length': '16', 'Content-Type': 'video/mp4', 'If-None-Match': '*' });
        assert.equal(init.body, f.files[0].blob);
        if (++tries === 1) throw new TypeError('lost reply');
        return { ok: false, status: 412 };
    };
    await uploadRenderFiles(f.files, f.options);
    assert.equal(tries, 2); assert.equal(f.counts().grants, 1); assert.equal(f.cache.get('local-1').complete, true);
});
test('expired PUT uses a fresh grant; failed refresh preserves budget error without reuploading completed files', async () => {
    const f = setup(), call = f.options.call; let tries = 0;
    f.options.transfer = async () => { if (++tries === 1) { f.time(901000); throw new TypeError('network'); } return { ok: true }; };
    await uploadRenderFiles(f.files, f.options);
    assert.equal(f.counts().grants, 2);
    const second = { ...f.files[0], id: 'local-2', blob: blob() };
    f.options.consent.push(second.id);
    f.options.call = async () => { throw Object.assign(new Error(), { code: 'upload_budget_exceeded' }); };
    await assert.rejects(uploadRenderFiles([...f.files, second], f.options), { code: 'upload_budget_exceeded' });
    assert.equal(tries, 2);
    f.options.call = call;
    await uploadRenderFiles([...f.files, second], f.options);
    assert.equal(tries, 3, 'only unfinished file uploads on retry');
});
test('network retries are bounded; abort and account change stop before the next grant or create', async () => {
    const f = setup(); let calls = 0;
    f.options.transfer = async () => { calls++; throw new TypeError('network'); };
    await assert.rejects(uploadRenderFiles(f.files, f.options)); assert.equal(calls, 3);
    const abort = new AbortController(); abort.abort(); f.options.signal = abort.signal;
    await assert.rejects(uploadRenderFiles(f.files, f.options), { name: 'AbortError' }); assert.equal(calls, 3);
    const g = setup(); g.options.transfer = async () => { g.switchAccount(); return { ok: true }; };
    await assert.rejects(uploadRenderFiles(g.files, g.options), { code: 'account_changed' });
    assert.equal(g.cache.get('local-1').complete, false);
    const h = setup(), stop = new AbortController(); h.options.signal = stop.signal;
    h.options.transfer = async () => { stop.abort(); return { ok: true }; };
    await assert.rejects(uploadRenderFiles(h.files, h.options), { name: 'AbortError' });
});
test('partial resume within 23h reuses; after 23h requires renewed consent then replaces swept source', async () => {
    const f = setup(); await uploadRenderFiles(f.files, f.options);
    f.options.consent = []; f.time(REUSE_MS - 1);
    await uploadRenderFiles(f.files, f.options); assert.equal(f.counts().puts, 1);
    f.time(2);
    await assert.rejects(uploadRenderFiles(f.files, f.options), { code: 'upload_consent_expired' });
    assert.equal(f.counts().puts, 1);
    f.options.consent = ['local-1']; await uploadRenderFiles(f.files, f.options);
    assert.equal(f.counts().puts, 2); assert.equal(f.counts().grants, 2);
});
test('delayed completion never extends reservation anchor; expiry checked immediately before first create', async () => {
    const f = setup(); f.options.transfer = async () => { f.time(90 * 60000); return { ok: true }; };
    await uploadRenderFiles(f.files, f.options); f.time((22 * 60 + 45) * 60000);
    assert.equal(pendingRenderFiles(f.files, f.cache, actor, f.options.now()).length, 1);
    const snapshot = renderSnapshot(f.local, 1080, 'Edit');
    assert.throws(() => uploadedRenderAttempt(snapshot, { credits: 1, resolution: '1080p' }, 'key', f.files, f.cache, actor, f.options.now()), { code: 'upload_consent_expired' });
});
test('sent create body and key stay immutable across source expiry and lost replies', async () => {
    const f = setup(); await uploadRenderFiles(f.files, f.options);
    const attempt = uploadedRenderAttempt(renderSnapshot(f.local, 1080, 'Edit'), { credits: 1, resolution: '1080p' }, 'same-key', f.files, f.cache, actor, f.options.now());
    const body = attempt.request.body; f.time(REUSE_MS * 2); f.cache.clear(); let sends = 0;
    await sendRenderAttempt(async (_, request) => {
        assert.equal(request.body, body); assert.equal(request.headers['Idempotency-Key'], 'same-key');
        if (++sends === 1) throw { code: 'network_error' }; return { job_id: id };
    }, attempt);
    assert.equal(sends, 2); assert.equal(f.counts().puts, 1); assert.ok(Object.isFrozen(attempt.snapshot.document));
});
test('quote for local ids equals remapped document, with identical seconds and resolution', async () => {
    const f = setup(), calls = [];
    const handlers = editorServerRenderHandlers({ rpc: async (name, args) => {
        if (name === 'consume_upload_request') return { ok: true };
        calls.push(args); return { credits: 3, max_seconds: 120 };
    } }, { enabled: true });
    const quote = document => handlers.quote(new Request('https://app.test/api/v1/editor/server-render/quote', {
        method: 'POST', headers: { 'x-veyrnox-auth-id': actor, 'x-request-id': id, 'content-type': 'application/json' }, body: JSON.stringify({ document, resolution: '1080p' }),
    }));
    const a = await quote(f.local), b = await quote(remapRenderDocument(f.local, new Map([['local-1', `u-${id}`]])));
    assert.equal(a.status, 200); assert.equal(b.status, 200); assert.deepEqual(await a.json(), await b.json()); assert.deepEqual(calls[0], calls[1]);
});
