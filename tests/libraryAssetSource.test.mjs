import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    GRSAI_API_KEY: 'test-grsai', PUBLIC_HOST: 'https://veyrnox.test',
    R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test',
});
const { POST } = await import('../app/api/v1/generations/route.js');

// A finished Library image used as an edit's source (studio "From library").
const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const MINE = '44444444-4444-4444-8444-444444444444';
const THEIRS = '55555555-5555-4555-8555-555555555555';
const ASSET_KEY = `jobs/${MINE}/output.png`;
const UPLOAD = `uploads/${AUTH}/33333333-3333-4333-8333-333333333333.png`;
const model = { id: 'nano-banana-pro-edit-grsai', provider: 'grsai', provider_endpoint: 'grsai:nano-banana-pro-edit', modality: 'image-to-image', credits_5s: 2, active: true, gated_flag: false };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==', 'base64');

function network({ asset = { ok: true, state: 'STORED', r2_key: ASSET_KEY, mime_type: 'image/png', size_bytes: png.length } } = {}) {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        calls.push({ url: u.href, method: init.method, body });
        if (u.pathname.includes('/rpc/')) {
            const name = u.pathname.split('/rpc/')[1];
            if (name === 'get_user_asset') {
                // Ownership is the RPC's: anyone else's job reads as missing.
                return Response.json(body.p_auth_id === AUTH && body.p_job_id === MINE ? asset : { ok: false, code: 'NOT_FOUND' });
            }
            if (name === 'ledger_debit') return Response.json({ ok: true, job_id: JOB, balance_after: 98 });
            return Response.json({ ok: true });
        }
        if (u.pathname === '/rest/v1/model_catalog') return Response.json([model]);
        if (u.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
        if (u.hostname === 'grsaiapi.com') return Response.json({ code: 0, data: { id: 'edit-task' } });
        if (u.hostname.endsWith('.r2.cloudflarestorage.com')) {
            return new Response(png, { status: 206, headers: { 'content-type': 'image/png', 'content-range': `bytes 0-${png.length - 1}/${png.length}` } });
        }
        throw new Error(`Unexpected request: ${u.hostname}${u.pathname}`);
    };
    return { calls, restore: () => { globalThis.fetch = real; } };
}
const rpcCalls = (net, name) => net.calls.filter((c) => c.url.includes(`/rpc/${name}`));
const submits = (net) => net.calls.filter((c) => c.url.endsWith('/draw/nano-banana'));
function post(extra = {}) {
    return POST(new Request('https://veyrnox.test/api/v1/generations', {
        method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ model_id: model.id, idempotency_key: 'library-source-test', consent: true, source_assets: [MINE],
            inputs: { prompt: 'Make the teapot blue', image_url: 'https://attacker.example/input.png' }, ...extra }),
    }));
}

test('an owned Library image becomes the source, recorded by job id and signed by us', async () => {
    const net = network();
    try {
        assert.equal((await post()).status, 200);
        const lookup = rpcCalls(net, 'get_user_asset')[0].body;
        assert.deepEqual(lookup, { p_auth_id: AUTH, p_job_id: MINE });
        const debit = rpcCalls(net, 'ledger_debit')[0].body;
        assert.deepEqual(debit.p_inputs.source_assets, { image_url: MINE });
        assert.equal(debit.p_inputs.source_keys, undefined, 'the upload sweep must never see a Library asset');
        assert.equal(debit.p_inputs.image_url, undefined, 'no presigned URL is stored');
        const source = new URL(submits(net)[0].body.urls[0]);
        assert.equal(source.hostname, 'test.r2.cloudflarestorage.com');
        assert.match(source.pathname, new RegExp(ASSET_KEY.replace(/[/.]/g, '\\$&')));
        assert.ok(!net.calls.some((c) => c.url.includes('attacker.example')));
    } finally { net.restore(); }
});

test('anything but an owned, stored image of an allowed type never debits or submits', async () => {
    for (const [extra, expected, asset] of [
        [{ source_assets: [THEIRS] }, 'source_not_found'],
        [{}, 'source_not_found', { ok: true, state: 'SUBMITTED', r2_key: ASSET_KEY, mime_type: 'image/png' }],
        [{}, 'source_type_unsupported', { ok: true, state: 'STORED', r2_key: ASSET_KEY, mime_type: 'image/gif' }],
        [{}, 'source_type_unsupported', { ok: true, state: 'STORED', r2_key: ASSET_KEY, mime_type: 'video/mp4' }],
        [{}, 'source_not_found', { ok: true, state: 'STORED', r2_key: ASSET_KEY, mime_type: 'image/png', asset_expires_at: '2020-01-01T00:00:00Z' }],
        [{ source_assets: ['not-a-uuid'] }, 'source_asset_invalid'],
        [{ source_assets: MINE }, 'source_asset_invalid'],
        [{ source_assets: [MINE, MINE, MINE] }, 'source_asset_invalid'],
        [{ consent: false }, 'consent_required'],
        [{ source_key: UPLOAD }, 'source_key_invalid'],
    ]) {
        const net = network(asset ? { asset } : undefined);
        try {
            const res = await post(extra);
            assert.ok(res.status >= 400, `${expected}: status ${res.status}`);
            assert.equal((await res.json()).error, expected);
            assert.equal(rpcCalls(net, 'ledger_debit').length, 0);
            assert.equal(submits(net).length, 0);
        } finally { net.restore(); }
    }
});
