import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-role', TOP_UP_READ_RATE_LIMIT_ENABLED: 'true' });
const history = await import('../app/api/v1/top-ups/route.js');
const status = await import('../app/api/v1/top-ups/[id]/route.js');
const returned = await import('../app/api/v1/top-ups/[id]/return/route.js');
const auth = '11111111-1111-4111-8111-111111111111', user = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const top = { id, status: 'credited', credits: 100, price_usd_cents: 1000, created_at: '2026-09-24', credited_at: '2026-09-24' };
const invoke = (route, identity = auth, topId = id) => route.GET(new Request('https://veyrnox.test/api/v1/top-ups', { headers: identity ? { 'x-veyrnox-auth-id': identity } : {} }), { params: Promise.resolve({ id: topId }) });
let calls;
function stub({ rate = { ok: true }, fail, missing = false } = {}) {
    calls = [];
    globalThis.fetch = async (url, init) => {
        const u = new URL(url), name = u.pathname.split('/').pop(); calls.push(name);
        if (name === fail) throw new Error('private backend detail');
        if (name === 'consume_top_up_read_request') {
            assert.deepEqual(JSON.parse(init.body), { p_auth_id: auth }); return Response.json(rate);
        }
        if (name === 'users') { assert.equal(u.searchParams.get('auth_id'), `eq.${auth}`); return Response.json(missing ? [] : [{ id: user }]); }
        if (name === 'top_ups') {
            assert.equal(u.searchParams.get('user_id'), `eq.${user}`);
            assert.equal(u.searchParams.get('limit'), '21');
            assert.equal(u.searchParams.get('order'), 'created_at.desc,id.desc');
            return Response.json([top]);
        }
        assert.equal(name, 'read_top_up');
        assert.deepEqual(JSON.parse(init.body), { p_auth_id: auth, p_top_up_id: id });
        return Response.json(missing ? { ok: false } : { ok: true, top_up: top });
    };
}
test('invalid identities and status IDs stop before quota or data work', async () => {
    stub();
    for (const route of [history, status]) for (const identity of [null, 'bad', '../forged']) assert.equal((await invoke(route, identity)).status, 401);
    assert.equal((await invoke(status, auth, 'bad')).status, 400);
    assert.deepEqual(calls, []);
});
test('both reads deny before owner lookup with bounded retry and no-store', async () => {
    for (const route of [history, status]) for (const [retry, expected] of [[12,12],[0,1],[999,60],[null,60],['3',60]]) {
        stub({ rate: { ok: false, code: 'RATE_LIMITED', retry_after_seconds: retry } });
        const res = await invoke(route);
        assert.equal(res.status, 429); assert.equal(res.headers.get('retry-after'), String(expected));
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await res.json(), { error: 'rate_limited', retry_after_seconds: expected });
        assert.deepEqual(calls, ['consume_top_up_read_request']);
    }
});
test('both reads fail closed on malformed or unavailable quota', async () => {
    for (const route of [history, status]) for (const opts of [{ rate:null }, { rate:{} }, { rate:{ok:'true'} }, { rate:{ok:false,code:'OTHER'} }, { fail:'consume_top_up_read_request' }]) {
        stub(opts); const res = await invoke(route);
        assert.equal(res.status, 503); assert.equal(res.headers.get('retry-after'), '30');
        assert.deepEqual(await res.json(), { error:'rate_limit_unavailable' });
        assert.deepEqual(calls, ['consume_top_up_read_request']);
    }
});
test('admitted reads preserve owner scope and response fields', async () => {
    stub(); const h = await invoke(history); assert.equal(h.status,200);
    assert.equal((await h.json()).top_ups[0].id,id);
    assert.deepEqual(calls,['consume_top_up_read_request','users','top_ups']);
    stub(); const s = await invoke(status); assert.equal(s.headers.get('cache-control'),'no-store');
    assert.deepEqual(await s.json(),top); assert.deepEqual(calls,['consume_top_up_read_request','read_top_up']);
    stub({missing:true}); assert.equal((await invoke(status)).status,404);
});
test('unknown accounts preserve empty history or 404 without downstream work', async () => {
    for (const [route, code, body] of [[history,200,{top_ups:[]}],[status,404,{error:'not_found'}]]) {
        stub({rate:{ok:false,code:'NOT_FOUND'}}); const res = await invoke(route);
        assert.equal(res.status,code); assert.deepEqual(await res.json(),body);
        assert.deepEqual(calls,['consume_top_up_read_request']);
    }
});
test('disabled rollout never calls the new RPC and data failures remain typed', async () => {
    process.env.TOP_UP_READ_RATE_LIMIT_ENABLED = 'false';
    try { for (const route of [history,status]) { stub({fail:'consume_top_up_read_request'}); assert.equal((await invoke(route)).status,200); assert.ok(!calls.includes('consume_top_up_read_request')); } }
    finally { process.env.TOP_UP_READ_RATE_LIMIT_ENABLED = 'true'; }
    for (const [route,fail] of [[history,'users'],[status,'read_top_up']]) { stub({fail}); const res=await invoke(route); assert.equal(res.status,502); assert.deepEqual(await res.json(),{error:'internal'}); }
});
test('changing read route or Top-up id cannot choose another quota bucket', async () => {
    let used = 0;
    globalThis.fetch = async (url,init) => {
        const name = new URL(url).pathname.split('/').pop();
        if (name === 'consume_top_up_read_request') {
            assert.deepEqual(JSON.parse(init.body),{p_auth_id:auth});
            return Response.json(++used === 1 ? {ok:true} : {ok:false,code:'RATE_LIMITED'});
        }
        assert.equal(name,'users'); return Response.json([]);
    };
    assert.equal((await invoke(history)).status,200);
    assert.equal((await invoke(status,auth,user)).status,429);
});
test('Stripe return remains available independently of read quota', async () => {
    globalThis.fetch = async (url) => { assert.equal(new URL(url).pathname.split('/').pop(),'record_top_up_return_session'); return Response.json({ok:true}); };
    const res = await returned.POST(new Request('https://veyrnox.test/api/v1/top-ups/'+id+'/return', {method:'POST', headers:{'x-veyrnox-auth-id':auth}, body:JSON.stringify({session_id:'cs_test_recovery'})}), {params:Promise.resolve({id})});
    assert.equal(res.status,200);
});
