import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'bucket',
});
delete process.env.ASSET_LINK_RATE_LIMIT_ENABLED;
const { GET } = await import('../app/api/v1/jobs/[id]/media-info/route.js');
const original = globalThis.fetch;
test.after(() => { globalThis.fetch = original; });

const box = (type, payload) => {
    const b = new Uint8Array(8 + payload.length);
    new DataView(b.buffer).setUint32(0, b.length);
    b.set([...type].map(c => c.charCodeAt(0)), 4);
    b.set(payload, 8);
    return b;
};
const join = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
};
function mp4(seconds, width, height) {
    const mvhd = new Uint8Array(100);
    new DataView(mvhd.buffer).setUint32(12, 1000);
    new DataView(mvhd.buffer).setUint32(16, seconds * 1000);
    const tkhd = new Uint8Array(84);
    const tv = new DataView(tkhd.buffer);
    tv.setUint32(76, width * 65536);
    tv.setUint32(80, height * 65536);
    const moov = box('moov', join(box('mvhd', mvhd), box('trak', box('tkhd', tkhd))));
    const ftyp = box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]));
    return join(ftyp, moov, box('mdat', new Uint8Array(512)));
}

const JOB = '11111111-1111-4111-8111-111111111111';
const KEY = 'user/abc/job/def.mp4';
const call = (id = JOB, headers = { 'x-veyrnox-auth-id': 'auth-user-1' }) =>
    GET(new Request(`https://veyrnox.test/api/v1/jobs/${id}/media-info`, { headers }), { params: Promise.resolve({ id }) });

function stub(asset, file) {
    const seen = { rpc: null, r2Calls: 0 };
    globalThis.fetch = async (url, init = {}) => {
        if (String(url).includes('get_user_asset')) { seen.rpc = JSON.parse(init.body); return Response.json(asset); }
        seen.r2Calls++;
        const range = /bytes=(\d+)-(\d+)/.exec(init.headers?.Range || '');
        const slice = range ? file.slice(Number(range[1]), Number(range[2]) + 1) : file;
        return new Response(slice, { status: range ? 206 : 200 });
    };
    return seen;
}

test('returns the stored length and frame, read with the verified auth id', async () => {
    const file = mp4(12, 1280, 720);
    const seen = stub({ ok: true, state: 'STORED', mime_type: 'video/mp4', r2_key: KEY, size_bytes: file.length }, file);
    const res = await call();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control'), /no-store/);
    assert.deepEqual(await res.json(), { seconds: 12, width: 1280, height: 720, size_bytes: file.length, mime_type: 'video/mp4' });
    assert.equal(seen.rpc.p_auth_id, 'auth-user-1');
    assert.equal(seen.rpc.p_job_id, JOB);
});

test('a job that is not the caller\'s, or not finished, is 404 and no bytes are read', async () => {
    for (const asset of [{ ok: false, code: 'NOT_FOUND' }, { ok: true, state: 'SUBMITTED', mime_type: 'video/mp4', r2_key: KEY, size_bytes: 10 }]) {
        const seen = stub(asset, new Uint8Array(0));
        const res = await call();
        assert.equal(res.status, 404);
        assert.equal(seen.r2Calls, 0);
    }
});

test('an image or audio job is refused as not_video before any read', async () => {
    const seen = stub({ ok: true, state: 'STORED', mime_type: 'image/png', r2_key: KEY, size_bytes: 10 }, new Uint8Array(0));
    const res = await call();
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'not_video');
    assert.equal(seen.r2Calls, 0);
});

test('unreadable headers are 422, a bad id is 400, no identity is 401', async () => {
    stub({ ok: true, state: 'STORED', mime_type: 'video/mp4', r2_key: KEY, size_bytes: 64 }, new Uint8Array(64));
    assert.equal((await call()).status, 422);
    assert.equal((await call('not-a-uuid')).status, 400);
    assert.equal((await call(JOB, {})).status, 401);
});
