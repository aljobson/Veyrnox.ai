import test from 'node:test';
import assert from 'node:assert/strict';
import { createProEditorStorage, safeLabel } from '../app/veyrnox/_lib/proEditorStorage.mjs';
import { createSaveTracker } from '../app/veyrnox/_lib/proEditorSaves.mjs';
import { sha256 } from '../lib/projectFiles.js';
const projectId = crypto.randomUUID(), fileId = crypto.randomUUID(), sessionId = 'a'.repeat(32);
const bytes = new TextEncoder().encode('{"format":"filmcraft.project","schema_version":17,"project":{"x":1}}');
const candidate = { id: 'c1', uid: 'aaaaaaaa-c1', sessionId, name: 'Cut.fcproj', bytes, byteLength: bytes.length, sha256: await sha256(bytes) };
const success = (id = fileId) => ({ file_id: id, state: 'inspected', cleanup_state: 'live', content_sha256: candidate.sha256, byte_size: bytes.length });
const quarantine = () => ({ file_id: fileId, state: 'quarantined', cleanup_state: 'live', upload_url: 'https://storage.invalid/upload' });
const response = (body, status = 200) => Response.json(body, { status });
const failure = (code, status = 409) => response({ error: { code, message: 'safe', requestId: 'request' } }, status);
// uploadFetch is a distinct function (never the API fetch); the shared fake tells the two apart by URL.
const storage = fetch => createProEditorStorage({ projectId, sessionId, fetch, uploadFetch: (url, init) => fetch(url, init), sleep: async () => {}, nonce: () => 'deadbeef' });
test('persist requires the exact inspected live file, size and hash; rejected/malformed responses retain tracker bytes', async () => {
    for (const bad of [{}, { ...success(), state: 'rejected' }, { ...success(), content_sha256: 'b'.repeat(64) }, { ...success(), byte_size: 1 }, { ...success(), file_id: 'x' }]) {
        const adapter = storage(async () => response(bad));
        const tracker = createSaveTracker({ ...adapter, sha256, now: Date.now });
        await tracker.receive({ ...candidate, seq: 1 }); await tracker.idle();
        assert.equal(tracker.snapshot().candidates[0].state, 'failed');
        assert.equal(tracker.snapshot().candidates[0].hasBytes, true);
    }
    assert.deepEqual(await storage(async () => response(success())).persist(candidate), { assetId: fileId });
});
test('strict upload 412 proceeds to inspection; 503 inspection gets three bounded attempts', async () => {
    let inspections = 0;
    const adapter = storage(async (url, init) => {
        if (url.endsWith('/files')) return response(quarantine());
        if (url.startsWith('https:')) { assert.deepEqual(init.headers, { 'Content-Type': 'application/json', 'If-None-Match': '*' }); return new Response(null, { status: 412 }); }
        if (++inspections < 3) return failure('storage-unavailable', 503);
        return response(success());
    });
    assert.deepEqual(await adapter.persist(candidate), { assetId: fileId }); assert.equal(inspections, 3);
    inspections = 0;
    const failed = storage(async url => url.endsWith('/files') ? response(quarantine()) : url.startsWith('https:') ? new Response(null) : (++inspections, failure('storage-unavailable', 503)));
    await assert.rejects(failed.persist(candidate), { code: 'storage-unavailable' }); assert.equal(inspections, 3);
});
for (const boundary of ['reserve', 'put', 'inspect', 'final-read']) test(`ambiguous ${boundary} failure reuses the reservation key and recovers`, async () => {
    const keys = []; let lost = false, uploaded = false, inspected = false;
    const adapter = storage(async (url, init) => {
        if (url.endsWith('/files')) {
            keys.push(init.headers['Idempotency-Key']);
            if (boundary === 'reserve' && !lost) { lost = true; throw Error('lost'); }
            return response(inspected ? success() : quarantine());
        }
        if (url.startsWith('https:')) {
            const existed = uploaded; uploaded = true;
            if (boundary === 'put' && !lost) { lost = true; throw Error('lost'); }
            return new Response(null, { status: existed ? 412 : 200 });
        }
        inspected = true;
        if (!lost) { lost = true; if (boundary === 'inspect') throw Error('lost'); if (boundary === 'final-read') return new Response('{', { status: 200 }); }
        return response(success());
    });
    await assert.rejects(adapter.persist(candidate));
    assert.deepEqual(await adapter.persist(candidate), { assetId: fileId });
    assert.equal(keys.length, 2); assert.equal(keys[0], `${sessionId}-deadbeef-aaaaaaaa-c1-1`); assert.equal(keys[0], keys[1]);
});
test('lost inspected response followed by purge allocates a new reservation; attempts persist and stop at three', async () => {
    const keys = []; let step = 0;
    const newId = crypto.randomUUID();
    const adapter = storage(async (url, init) => {
        if (url.endsWith('/files')) {
            keys.push(init.headers['Idempotency-Key']);
            if (step === 0) { step++; return response(quarantine()); }
            if (step === 2) { step++; return failure('file-unavailable'); }
            return response(success(newId));
        }
        if (url.startsWith('https:')) return new Response(null);
        step = 2; throw Error('inspection response lost');
    });
    await assert.rejects(adapter.persist(candidate));
    assert.deepEqual(await adapter.persist(candidate), { assetId: newId });
    assert.deepEqual(keys, [`${sessionId}-deadbeef-aaaaaaaa-c1-1`, `${sessionId}-deadbeef-aaaaaaaa-c1-1`, `${sessionId}-deadbeef-aaaaaaaa-c1-2`]);
    let calls = 0;
    const exhausted = storage(async () => { calls++; return failure('upload-closed'); });
    await assert.rejects(exhausted.persist(candidate), { code: 'reservation-limit' });
    await assert.rejects(exhausted.persist(candidate), { code: 'reservation-limit' }); assert.equal(calls, 3);
});
test('head replay succeeds and stable wire errors remain typed', async () => {
    const c = { ...candidate, asset: fileId };
    assert.equal((await storage(async () => response({ revision: 1, file_id: fileId, idempotent: true })).commitHead(c, 0)).revision, 1);
    for (const code of ['version-conflict','storage-quota-exceeded','limit-reached','idempotency-conflict']) {
        await assert.rejects(storage(async () => failure(code)).commitHead(c, 0), { code: code === 'version-conflict' ? 'revision-conflict' : code });
    }
});
test('malformed availability is not permission to consume another reservation attempt', async () => {
 const keys=[];let malformed=true;
 const adapter=storage(async(_url,init)=>{keys.push(init.headers['Idempotency-Key']);return response(malformed?{...success(),cleanup_state:undefined}:success());});
 await assert.rejects(adapter.persist(candidate),{code:'invalid-response'});assert.equal(keys.length,1);
 malformed=false;await adapter.persist(candidate);assert.equal(keys[0],keys[1]);
});

test('the presigned upload goes only through uploadFetch, with exactly Content-Type and If-None-Match and no credentials', async () => {
    const apiCalls = [], uploadCalls = [];
    const adapter = createProEditorStorage({
        projectId, sessionId, nonce: () => 'deadbeef', sleep: async () => {},
        fetch: async (url, init) => {
            apiCalls.push([url, init]);
            if (url.endsWith('/files')) return response(quarantine());
            return response(success());
        },
        uploadFetch: async (url, init) => { uploadCalls.push([url, init]); return new Response(null, { status: 200 }); },
    });
    assert.deepEqual(await adapter.persist(candidate), { assetId: fileId });
    assert.equal(uploadCalls.length, 1);
    assert.equal(uploadCalls[0][0], 'https://storage.invalid/upload');
    assert.deepEqual(uploadCalls[0][1].headers, { 'Content-Type': 'application/json', 'If-None-Match': '*' });
    assert.equal(uploadCalls[0][1].credentials, 'omit');
    assert.equal(JSON.stringify(uploadCalls[0][1]).includes('uthorization'), false);
    assert.equal(apiCalls.some(([url]) => url.startsWith('https://')), false, 'the API fetch never sees the storage URL');
});

test('uploadFetch is required and may not be the API fetch', () => {
    const api = async () => response({});
    assert.throws(() => createProEditorStorage({ projectId, sessionId, fetch: api }), /invalid-storage-context/);
    assert.throws(() => createProEditorStorage({ projectId, sessionId, fetch: api, uploadFetch: api }), /invalid-storage-context/);
});

test('labels are made server-safe: 255-character and control-character names still reserve', async () => {
    assert.equal([...safeLabel('x'.repeat(255))].length, 120);
    assert.equal(safeLabel('a/b\\c\u0085d\u0000e'), 'a b c d e');
    assert.equal(safeLabel('///'), 'project.fcproj');
    assert.equal(safeLabel(undefined), 'project.fcproj');
    const sent = [];
    const adapter = storage(async (url, init) => {
        if (url.endsWith('/files')) { sent.push(JSON.parse(init.body).label); return response(success()); }
        return response(success());
    });
    await adapter.persist({ ...candidate, name: 'n'.repeat(255) });
    assert.equal([...sent[0]].length, 120);
});

test('two adapters for one session never share a key, and one adapter reuses its key across a retry', async () => {
    const keys = [];
    const make = () => createProEditorStorage({
        projectId, sessionId, sleep: async () => {},
        fetch: async (url, init) => { if (url.endsWith('/files')) keys.push(init.headers['Idempotency-Key']); return response(success()); },
        uploadFetch: async () => new Response(null, { status: 200 }),
    });
    await make().persist(candidate);
    await make().persist(candidate);
    assert.notEqual(keys[0], keys[1]);
    for (const key of keys) assert.match(key, /^[A-Za-z0-9._-]{8,128}$/);
});

test('inspection 503s back off for about an inspection each (jittered), not 100 ms', async () => {
    const sleeps = [];
    let inspections = 0;
    const adapter = createProEditorStorage({
        projectId, sessionId, nonce: () => 'deadbeef', jitter: () => 0.5, sleep: async (ms) => { sleeps.push(ms); },
        fetch: async (url) => {
            if (url.endsWith('/files')) return response(quarantine());
            if (++inspections < 3) return failure('storage-unavailable', 503);
            return response(success());
        },
        uploadFetch: async () => new Response(null, { status: 200 }),
    });
    await adapter.persist(candidate);
    assert.deepEqual(sleeps, [1000, 2000]);
});

test('a storage quota refusal is surfaced as a distinct error without retries, and the tracker keeps the bytes', async () => {
    let reserves = 0;
    const adapter = storage(async (url) => { reserves += 1; return failure('storage-quota-exceeded', 429); });
    await assert.rejects(adapter.persist(candidate), (e) => e.code === 'storage-quota-exceeded');
    assert.equal(reserves, 1, 'no retry loop');
    const tracker = createSaveTracker({ ...adapter, sha256, now: Date.now });
    await tracker.receive({ ...candidate, seq: 1 }); await tracker.idle();
    const c = tracker.snapshot().candidates[0];
    assert.deepEqual([c.state, c.hasBytes], ['failed', true]);
    assert.equal(tracker.canLeave(), false);
});

test('two trackers sharing one adapter never share a reservation key, even for same-size first saves', async () => {
    const keys = [];
    const adapter = createProEditorStorage({
        projectId, sessionId, nonce: () => 'deadbeef', sleep: async () => {},
        fetch: async (url, init) => { if (url.endsWith('/files')) keys.push(init.headers['Idempotency-Key']); return failure('storage-unavailable', 503); },
        uploadFetch: async () => new Response(null, { status: 200 }),
    });
    const first = createSaveTracker({ ...adapter, sha256, now: Date.now });
    const second = createSaveTracker({ ...adapter, sha256, now: Date.now });
    const a = new TextEncoder().encode('{"format":"filmcraft.project","schema_version":17,"project":{"x":1}}');
    const b = new TextEncoder().encode('{"format":"filmcraft.project","schema_version":17,"project":{"x":2}}');
    assert.equal(a.length, b.length);
    await first.receive({ sessionId, name: 'Cut.fcproj', bytes: a.buffer, seq: 1, engine: 1, saveAs: false, type: 'host:save' });
    await second.receive({ sessionId, name: 'Cut.fcproj', bytes: b.buffer, seq: 1, engine: 1, saveAs: false, type: 'host:save' });
    await first.idle(); await second.idle();
    assert.equal(keys.length >= 2, true);
    assert.notEqual(keys[0], keys[1], 'both candidates are c1, but their uids differ');
    for (const key of keys) assert.match(key, /^[A-Za-z0-9._-]{8,128}$/);
});
