import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { editorServerRenderHandlers } from '../lib/editorServerRender.js';
import { validateRenderUpload } from '../lib/editorServerRenderUploads.js';
const auth = '22222222-2222-4222-8222-222222222222', id = '11111111-1111-4111-8111-111111111111';
const video = new TextEncoder().encode('0123ftypisom0000');
const mp3 = new TextEncoder().encode('ID3\0\0\0\0\0\0\0\0\0\0\0\0\0');
const wav = new TextEncoder().encode('RIFF0000WAVE0000');
function fixture() {
    const timeline = JSON.parse(readFileSync(new URL('./fixtures/editorServerRender/v2.json', import.meta.url)));
    timeline.media[`u-${id}`] = { ...timeline.media[`j-${id}`], id: `u-${id}` };
    delete timeline.media[`j-${id}`]; timeline.video.forEach(c => { c.mediaId = `u-${id}`; });
    const document = { schema_version: 2, project_id: id, brief: '', canvas: { aspect_ratio: '16:9', frame_rate: 30 }, timeline };
    let job, sourcesAvailable = true, objectAvailable = true, debits = 0, signed = 0, runs = 0, reads = 0;
    const deps = {
        env: {},
        rpc: async (name, args) => {
            if (name === 'consume_upload_request') return { ok: true };
            if (name === 'replay_server_render') return job && JSON.stringify(args.p_document) === JSON.stringify(job.document) ? { ok: true, idempotent: true, ...job } : null;
            if (name === 'server_render_source') {
                reads++;
                return sourcesAvailable ? { ok: true, r2_key: 'key', size_bytes: 16, mime_type: args.p_media_id.startsWith('u-') ? 'video/mp4' : 'audio/wav' } : { ok: false };
            }
            if (name === 'admit_server_render') {
                debits++; job = { job_id: id, credits: 7, state: 'SUBMITTED', document: structuredClone(args.p_document) }; return { ok: true, ...job };
            }
            throw new Error(name);
        },
        get: async () => objectAvailable ? { ok: true, response: new Response(video, { headers: { 'content-type': 'video/mp4', 'content-length': '16' } }) } : { ok: false },
        signGet: async () => { signed++; return { url: 'https://r2.test/source' }; },
        runner: { run: async () => { runs++; return { ok: true }; } },
    };
    const handlers = editorServerRenderHandlers(deps, { enabled: true });
    const create = (doc = document) => handlers.create(new Request('https://app.test/api/v1/editor/server-render', { method: 'POST',
        headers: { 'x-veyrnox-auth-id': auth, 'x-request-id': id, 'idempotency-key': 'upload-replay-1', 'content-type': 'application/json' },
        body: JSON.stringify({ document: doc, resolution: '1080p', label: 'Edit', quoted_credits: 7 }) }));
    return { deps, document, create, sweep: () => { sourcesAvailable = false; objectAvailable = false; }, counts: () => ({ debits, signed, runs, reads }) };
}
test('lost create response followed by reservation expiry and sweep replays original debit without reading or signing sources', async () => {
    const f = fixture(); assert.equal((await f.create()).status, 202);
    const before = f.counts(); f.sweep();
    const replay = await f.create();
    assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), { job_id: id, credits: 7, state: 'SUBMITTED', idempotent: true });
    assert.deepEqual(f.counts(), before); assert.equal(before.debits, 1);
    const different = structuredClone(f.document); different.brief = 'Different document';
    assert.equal((await f.create(different)).status, 403); assert.equal(f.counts().debits, 1);
});
test('completed upload with admission subsequently closed is refused before signing or debit', async () => {
    const f = fixture(); f.deps.env = { UPLOAD_HASH_MATCH_REQUIRED: 'true' };
    const res = await f.create(); assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'upload_admission_unavailable' });
    assert.deepEqual(f.counts(), { debits: 0, signed: 0, runs: 0, reads: 0 });
});
for (const [name, bytes] of [['HTML', new TextEncoder().encode('<html>bad</html>!')], ['MP3 under MP4', mp3], ['truncated', video.subarray(0, 8)]]) {
    test(`${name} is refused without any source URL or debit`, async () => {
        const f = fixture();
        f.deps.get = async () => ({ ok: true, response: new Response(bytes, { headers: { 'content-type': 'video/mp4', 'content-length': '16' } }) });
        const res = await f.create(); assert.equal(res.status, 409);
        assert.equal(f.counts().signed, 0); assert.equal(f.counts().debits, 0); assert.equal(f.counts().runs, 0);
    });
}
for (const [mime, bytes] of [['video/mp4', video], ['audio/mpeg', mp3], ['audio/wav', wav]]) {
    test(`bounded signature accepts ${mime} and cancels body after 16 bytes`, async () => {
        let reads = 0, cancelled = false;
        const body = new ReadableStream({ pull(controller) { reads++; controller.enqueue(bytes); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
        await validateRenderUpload({ size_bytes: 100000, mime_type: mime, r2_key: 'key' }, { get: async () => ({ ok: true,
            response: new Response(body, { headers: { 'content-type': mime, 'content-length': '100000' } }) }) });
        assert.equal(reads, 1); assert.equal(cancelled, true);
    });
}
