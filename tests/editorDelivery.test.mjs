import test from 'node:test';
import assert from 'node:assert/strict';
import { localExportFile, accountBoundCall, saveEditorRender, ownedPublishUpload, editorDestinations } from '../app/veyrnox/_lib/editorDelivery.mjs';
const id = '11111111-1111-4111-8111-111111111111';
const file = new File(['export'], 'My edit.mp4', { type: 'video/mp4' });

test('delivery reads only the current origin local export; remote, MOV and empty exports issue no fetch', async () => {
    const result = { name: file.name, url: 'blob:https://veyrnox.test/local-render' };
    const loaded = await localExportFile(result, { origin: 'https://veyrnox.test', fetchBytes: async (url, init) => { assert.equal(url, result.url); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); return new Response(file); } });
    assert.equal(await loaded.text(), 'export'); assert.equal(loaded.type, 'video/mp4');
    for (const bad of [{ ...result, url: 'https://private.invalid/file' }, { ...result, url: 'blob:https://other.test/render' }, { ...result, name: 'edit.mov' }]) await assert.rejects(localExportFile(bad, { origin: 'https://veyrnox.test', fetchBytes: () => assert.fail('fetched untrusted URL') }));
    await assert.rejects(localExportFile({ name: 'edit.mp4', blob: new Blob([], { type: 'video/mp4' }) }));
});

test('actor changes reject both late responses and subsequent mutation or cleanup requests', async () => {
    let actor = 'owner'; let requests = 0;
    const call = accountBoundCall(async () => { requests++; actor = 'other'; return { private: true }; }, 'owner', () => actor);
    await assert.rejects(call('/private'), e => e.code === 'account_changed');
    await assert.rejects(call('/delete', { method: 'DELETE' }), e => e.code === 'account_changed');
    assert.equal(requests, 1);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(accountBoundCall(() => assert.fail('called after abort'), 'owner', () => 'owner', abort.signal)('/private'));
});

test('Library save hashes actual bytes, uses idempotency and completes only after write-once transfer and inspection', async () => {
    for (const status of [200, 412]) {
        const calls = [], phases = [];
        const saved = await saveEditorRender(file, { consent: true, idempotencyKey: 'same-export-save', onProgress: x => phases.push(x), call: async (path, init) => {
            calls.push(path);
            if (calls.length === 1) { const body = JSON.parse(init.body); assert.match(body.sha256, /^[0-9a-f]{64}$/); assert.equal(body.size_bytes, file.size); assert.equal(body.rights_confirmed, true); assert.equal(init.headers['Idempotency-Key'], 'same-export-save'); return { id, state: 'quarantined', upload_url: 'https://storage.test/put', headers: { 'If-None-Match': '*' } }; }
            assert.equal(path, `/library/editor-renders/${id}/inspect`); return { state: 'stored' };
        }, transfer: async (_url, init) => { assert.equal(init.body, file); assert.equal(init.credentials, 'omit'); assert.equal(init.headers['If-None-Match'], '*'); return { ok: status === 200, status }; } });
        assert.equal(saved.url, `/app/library#render-${id}`); assert.equal(calls.length, 2); assert.equal(phases.at(-1), 'Inspecting and saving…');
    }
});

test('rights, size and interrupted transfer never settle or publish a render', async () => {
    for (const change of [{ consent: false }, { file: new File([new Uint8Array(26214401)], 'big.mp4', { type: 'video/mp4' }) }]) await assert.rejects(saveEditorRender(change.file || file, { consent: true, idempotencyKey: 'save-request', call: () => assert.fail('reserved rejected file'), ...change }));
    let count = 0;
    await assert.rejects(saveEditorRender(file, { consent: true, idempotencyKey: 'save-request', call: async () => { count++; return { id, state: 'quarantined', upload_url: 'https://storage.test/put', headers: {} }; }, transfer: async () => ({ ok: false, status: 500 }) }));
    assert.equal(count, 1);
    assert.equal((await saveEditorRender(file, { consent: true, idempotencyKey: 'save-request', call: async () => ({ id, state: 'stored' }), transfer: () => assert.fail('reuploaded stored render') })).id, id);
});

test('Publish handoff resolves a verified upload in the current account, never URL-selected asset metadata', async () => {
    const uploaded = await ownedPublishUpload(async path => { assert.equal(path, '/social/uploads'); return { uploads: [{ id, mime_type: 'video/mp4', url: 'https://storage.test/private' }] }; }, id);
    assert.deepEqual(uploaded, { uploadId: id, mediaType: 'video', thumbUrl: 'https://storage.test/private' });
    await assert.rejects(ownedPublishUpload(() => assert.fail('invalid identifier fetched'), '../../other'));
    for (const uploads of [[], [{ id, mime_type: 'image/png', url: 'https://storage.test/image' }], [{ id, mime_type: 'video/mp4', url: 'javascript:bad' }]]) await assert.rejects(ownedPublishUpload(async () => ({ uploads }), id));
});

test('destination readiness uses actual media support, deployment readiness, connections and upload gate', () => {
    const data = { uploadsEnabled: true, networks: [{ key: 'youtube', available: true }], accounts: [{ id, network: 'youtube', status: 'active', publishingEnabled: true }] };
    assert.equal(editorDestinations(data).find(n => n.key === 'youtube').ready, true);
    for (const change of [{ uploadsEnabled: false }, { networks: [] }, { accounts: [] }, { accounts: [{ network: 'youtube', status: 'revoked', publishingEnabled: true }] }]) assert.equal(editorDestinations({ ...data, ...change }).find(n => n.key === 'youtube').ready, false);
    for (const key of ['instagram', 'facebook', 'tiktok']) assert.equal(editorDestinations({ ...data, networks: [{ key, available: true }], accounts: [{ network: key, status: 'active', publishingEnabled: true }] }).find(n => n.key === key).ready, false);
});

test('saved render handoff uses a fresh owned R2 link and verifies exact bytes before posting preparation', async () => {
    const { loadSavedRender } = await import('../app/veyrnox/_lib/editorSavedRender.mjs');
    const bytes = new TextEncoder().encode('saved export'), sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    const asset = { url: 'https://fb18d9f7052afbea5a5e0eae69948af2.eu.r2.cloudflarestorage.com/edit?signature=test', mime_type: 'video/mp4', size_bytes: bytes.length, sha256 };
    const loaded = await loadSavedRender(async path => { assert.equal(path, `/library/editor-renders/${id}/asset`); return asset; }, { id, label: 'Local edit.mp4' }, { fetchBytes: async (_url, init) => { assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); return new Response(bytes); } });
    assert.equal(await loaded.text(), 'saved export');
    for (const bad of [asset.url.replace('https:', 'http:'), 'https://untrusted.test/private', asset.url.replace('.com/', '.com:444/')]) await assert.rejects(loadSavedRender(async () => ({ ...asset, url: bad }), { id }, { fetchBytes: () => assert.fail('fetched untrusted URL') }));
    for (const badBytes of [bytes.slice(0, -1), new Uint8Array(bytes.length + 1), new Uint8Array(bytes.length)]) await assert.rejects(loadSavedRender(async () => asset, { id }, { fetchBytes: async () => new Response(badBytes) }));
});
