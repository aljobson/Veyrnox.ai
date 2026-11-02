import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { MINIMUM_AGE, ageConfirmationEnabled } from '../lib/minimumAge.js';
import { parseJsonc } from '../scripts/check-migration-ledger.mjs';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c);}`));
const { POST } = await import('../app/api/v1/account/age-confirmation/route.js');
const { GET } = await import('../app/api/v1/account/route.js');
const auth = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const originalFetch = globalThis.fetch;
const savedEnv = { ...process.env };
test.beforeEach(() => {
  Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test', AGE_CONFIRMATION_ENABLED: 'true', ACCOUNT_READ_RATE_LIMIT_ENABLED: 'false' });
  globalThis.fetch = async () => assert.fail('unexpected database call');
});
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','AGE_CONFIRMATION_ENABLED','ACCOUNT_READ_RATE_LIMIT_ENABLED']) {
    if (savedEnv[name] === undefined) delete process.env[name]; else process.env[name] = savedEnv[name];
  }
});
const request = (body = { confirm: true, version: 'age-18-v1' }, id = auth) => new Request('https://site.test/api/v1/account/age-confirmation', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(id ? { 'x-veyrnox-auth-id': id } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
test('18 is shared with mobile; only the exact true flag enables it; ships off', () => {
  assert.equal(MINIMUM_AGE, 18);
  assert.equal(Number(readFileSync('apps/mobile/src/lib/account.ts','utf8').match(/MIN_AGE\s*=\s*(\d+)/)[1]), MINIMUM_AGE);
  for (const value of [undefined, 'false', '', 'TRUE', true]) assert.equal(ageConfirmationEnabled({ AGE_CONFIRMATION_ENABLED: value }), false);
  assert.equal(ageConfirmationEnabled({ AGE_CONFIRMATION_ENABLED: 'true' }), true);
  const config = parseJsonc(readFileSync('wrangler.jsonc','utf8'));
  assert.equal(config.env.staging.vars.AGE_CONFIRMATION_ENABLED, 'false');
  assert.equal(config.vars.AGE_CONFIRMATION_ENABLED, undefined);
});
test('identity is required before flags or database access', async () => {
  for (const id of [null, '', 'malformed']) assert.equal((await POST(request(undefined,id))).status,401);
  process.env.AGE_CONFIRMATION_ENABLED = 'false';
  assert.equal((await POST(request())).status,404);
});
test('only affirmative JSON and a bounded version are accepted; no minor declaration stored', async () => {
  for (const body of ['{', null, [], {}, {confirm:false,version:'age-18-v1'}, {confirm:'true',version:'age-18-v1'}, {confirm:true,version:'x'}, {confirm:true,version:'X'.repeat(41)}, {confirm:true,version:'age_18'}]) {
    assert.equal((await POST(request(body))).status,400);
  }
});
test('API maps only verified auth identity to internal id, replay returns recorded confirmation', async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/users')) {
      assert.equal(u.searchParams.get('auth_id'), `eq.${auth}`);
      assert.equal(u.searchParams.get('deleted_at'), 'is.null');
      return Response.json([{id:user}]);
    }
    assert.ok(u.pathname.endsWith('/rpc/confirm_minimum_age'));
    assert.deepEqual(JSON.parse(init.body), {p_user_id:user,p_version:'age-18-v1'});
    calls++;
    return Response.json({ok:true,confirmed_at:'2026-11-02T00:00:00Z',version:'age-18-v1'});
  };
  const first = await POST(request({confirm:true,version:'age-18-v1',user_id:'foreign'}));
  assert.equal(first.headers.get('cache-control'),'no-store');
  assert.deepEqual(await first.json(), await (await POST(request())).json());
  assert.equal(calls,2);
});
test('backend failures are typed without leaking payloads', async () => {
  globalThis.fetch = async () => { throw Error('private database detail'); };
  const r = await POST(request());
  assert.equal(r.status,502);
  assert.deepEqual(await r.json(),{error:'confirmation_unavailable'});
});
test('account reports confirmation independently of flag, required only when enabled and unconfirmed', async () => {
  for (const flag of ['true','false']) for (const at of [null,'2026-11-02T00:00:00Z']) {
    process.env.AGE_CONFIRMATION_ENABLED = flag;
    globalThis.fetch = async url => {
      const path = new URL(url).pathname;
      if (path.endsWith('/users')) return Response.json([{id:user,age_confirmed_at:at}]);
      if (path.endsWith('/read_user_credits')) return Response.json({balance:0});
      return new Response(null,{headers:{'content-range':'*/0'}});
    };
    const r = await GET(new Request('https://site.test/api/v1/account',{headers:{'x-veyrnox-auth-id':auth}}));
    const data = await r.json();
    assert.equal(data.age_confirmed,Boolean(at));
    assert.equal(data.age_confirmation_required,flag==='true'&&!at);
  }
});
test('rolling deploy tolerates only the absent age column while disabled; enabling fails closed', async () => {
  const savedError = console.error;
  console.error = () => {};
  try {
    for (const flag of ['false','true']) {
      process.env.AGE_CONFIRMATION_ENABLED = flag;
      let fallback = 0;
      globalThis.fetch = async url => {
        const u = new URL(url);
        if (u.pathname.endsWith('/users')) {
          if (u.searchParams.get('select').includes('age_confirmed_at')) return Response.json({code:'42703',message:'column users.age_confirmed_at does not exist'}, {status:400});
          fallback++; return Response.json([{id:user}]);
        }
        if (u.pathname.endsWith('/read_user_credits')) return Response.json({balance:10});
        return new Response(null,{headers:{'content-range':'*/0'}});
      };
      const r=await GET(new Request('https://site.test/api/v1/account',{headers:{'x-veyrnox-auth-id':auth}}));
      assert.equal(r.status,flag==='false'?200:502);
      assert.equal(fallback,flag==='false'?1:0);
      if(flag==='false') assert.equal((await r.json()).age_confirmation_required,false);
    }
  } finally { console.error=savedError; }
});
test('missing-user limiter fallback and throttles never report age confirmation required', async () => {
  process.env.ACCOUNT_READ_RATE_LIMIT_ENABLED = 'true';
  for (const [code, status] of [['NOT_FOUND', 200], ['RATE_LIMITED', 429]]) {
    let calls = 0;
    globalThis.fetch = async url => {
      assert.ok(new URL(url).pathname.endsWith('/consume_account_read_request'));
      calls++;
      return Response.json({ ok: false, code, retry_after_seconds: 15 });
    };
    const response = await GET(new Request('https://site.test/api/v1/account', { headers: { 'x-veyrnox-auth-id': auth } }));
    assert.equal(response.status, status);
    assert.equal(Object.hasOwn(await response.json(), 'age_confirmation_required'), false);
    assert.equal(calls, 1);
  }
});
test('missing-user account projection is unavailable and confirmation returns account_not_found', async () => {
  globalThis.fetch = async url => {
    if (new URL(url).pathname.endsWith('/users')) return Response.json([]);
    assert.ok(new URL(url).pathname.endsWith('/read_user_credits'));
    return Response.json({ balance: 0 });
  };
  const response = await GET(new Request('https://site.test/api/v1/account', { headers: { 'x-veyrnox-auth-id': auth } }));
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(await response.json(), 'age_confirmation_required'), false);
  const confirm = await POST(request());
  assert.equal(confirm.status, 404);
  assert.deepEqual(await confirm.json(), { error: 'account_not_found' });
});
