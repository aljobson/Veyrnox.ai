import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test', R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'bucket' });
const { POST } = await import('../app/api/v1/jobs/shapes/route.js');
const id = '11111111-1111-4111-8111-111111111111';
const original = globalThis.fetch;
test.after(() => { globalThis.fetch = original; delete process.env.ASSET_LINK_RATE_LIMIT_ENABLED; });
const call = (body = { job_ids: [id] }, auth = true) => POST(new Request('https://veyrnox.test/api/v1/jobs/shapes', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { 'x-veyrnox-auth-id': 'owner' } : {}) }, body: JSON.stringify(body) }));
const box = (type, payload) => {
    const out = new Uint8Array(8 + payload.length); new DataView(out.buffer).setUint32(0, out.length);
    out.set([...type].map(c => c.charCodeAt(0)), 4); out.set(payload, 8); return out;
};
const join = (...parts) => new Uint8Array(parts.flatMap(part => [...part]));
const tkhd = new Uint8Array(84), mvhd = new Uint8Array(100);
new DataView(tkhd.buffer).setUint32(76, 1080 * 65536); new DataView(tkhd.buffer).setUint32(80, 1920 * 65536);
new DataView(mvhd.buffer).setUint32(12, 1000); new DataView(mvhd.buffer).setUint32(16, 5000);
const file = join(box('ftyp', new Uint8Array([105,115,111,109,0,0,2,0])), box('moov', join(box('mvhd', mvhd), box('trak', box('tkhd', tkhd)))), box('mdat', new Uint8Array(512)));

test('route reads real MP4 headers and only returns public dimensions', async () => {
    delete process.env.ASSET_LINK_RATE_LIMIT_ENABLED;
    const writes = [];
    globalThis.fetch = async (url, init = {}) => {
        if (String(url).includes('/rpc/')) {
            const args = JSON.parse(init.body); assert.equal(args.p_auth_id, 'owner');
            if (String(url).includes('list_unmeasured_video_shapes')) return Response.json([{ job_id: id, r2_key: 'secret/key.mp4', size_bytes: file.length }]);
            assert.match(String(url), /record_video_shape$/); writes.push(args); return Response.json({ recorded: true });
        }
        const range = /bytes=(\d+)-(\d+)/.exec(init.headers?.Range || '');
        return new Response(range ? file.slice(Number(range[1]), Number(range[2]) + 1) : file, { status: range ? 206 : 200 });
    };
    const res = await call(); assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { shapes: [{ job_id: id, width: 1080, height: 1920 }] });
    assert.deepEqual([writes[0].p_width, writes[0].p_height], [1080, 1920]);
});
test('migration absent returns 200 with no retry; other RPC failures remain typed', async () => {
    for (const [code, status] of [['PGRST202', 200], ['42501', 502]]) {
        globalThis.fetch = async () => Response.json({ code }, { status: 404 });
        const res = await call(); assert.equal(res.status, status); assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await res.json(), status === 200 ? { shapes: [] } : { error: 'shapes_unavailable' });
    }
});
test('identity and strict body validation happen before file reads', async () => {
    globalThis.fetch = async () => { throw new Error('must not fetch'); };
    assert.equal((await call({}, false)).status, 401);
    assert.equal((await call({ job_ids: [id, id] })).status, 400);
    assert.equal((await call({ job_ids: [id], r2_key: 'other' })).status, 400);
});
test('same asset-link limiter fails closed, preserves Retry-After, and never measures a refused call', async () => {
    process.env.ASSET_LINK_RATE_LIMIT_ENABLED = 'true';
    for (const [rate, status] of [[{ ok: false, code: 'RATE_LIMITED', retry_after_seconds: 5 }, 429], [{ ok: false, code: 'NOT_FOUND' }, 404], [{}, 503]]) {
        globalThis.fetch = async url => { assert.match(String(url), /consume_asset_link_request$/); return Response.json(rate); };
        const res = await call(); assert.equal(res.status, status);
        if (status === 429) assert.equal(res.headers.get('retry-after'), '5');
    }
    delete process.env.ASSET_LINK_RATE_LIMIT_ENABLED;
});
