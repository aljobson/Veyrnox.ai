import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', PUBLIC_HOST: 'https://veyrnox.test',
  CRUN_ENABLED: 'true', CRUN_API_KEY: 'test-crun', SUPPLIER_ROUTES_ENABLED: 'false',
  R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test',
});

const { POST } = await import('../app/api/v1/generations/route.js');
const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const SOURCES = [
  `uploads/${AUTH}/33333333-3333-4333-8333-333333333333.png`,
  `uploads/${AUTH}/44444444-4444-4444-8444-444444444444.png`,
];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==', 'base64');
const model = {
  id: 'crun-catalog-seedance-template', provider: 'crun', provider_endpoint: 'crun:bytedance/template',
  modality: 'image-to-video', credits_5s: 170, provider_cost_per_unit: 3.0355, cost_unit: 'per_generation',
  active: true, gated_flag: false,
};

const request = (credits = 97) => new Request('https://veyrnox.test/api/v1/generations', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-veyrnox-auth-id': AUTH },
  body: JSON.stringify({
    model_id: 'catalog-template', idempotency_key: 'seedance-catalog-template', confirmed_credits: credits,
    consent: true, inputs: {}, source_keys: SOURCES.map(key => ({ slot: 'image', key })),
    catalog_template: { provider: 'seedance', catalog_id: 'seedance:1:1:42', resolution: '720p' },
  }),
});

function network(t) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const parsed = new URL(String(url));
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: parsed.href, path: parsed.pathname, body });
    if (parsed.pathname.endsWith('/rpc/check_generation_rate_limit')) return Response.json({ ok: true });
    if (parsed.pathname.endsWith('/rpc/ledger_debit')) return Response.json({ ok: true, job_id: JOB, idempotent: false, balance_after: 500 });
    if (parsed.pathname.includes('/rpc/')) return Response.json({ ok: true });
    if (parsed.pathname === '/rest/v1/model_catalog') return Response.json([model]);
    if (parsed.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
    if (parsed.pathname === '/api/v1/client/job/bytedance-templates') return Response.json({
      code: 200, data: { total: 1, templates: [{
        TemplateId: '42', Title_en: 'Two-person dance', InputNum: 2,
        ConsumeItems: [{ Resolution: '720p', Credit: 355.2 }],
      }] },
    });
    if (parsed.pathname === '/api/v1/client/job/CreateTask') return Response.json({ code: 200, data: { task_id: 'catalog-task-1' } });
    if (parsed.hostname.endsWith('.r2.cloudflarestorage.com')) return new Response(png, {
      status: 206, headers: { 'content-type': 'image/png', 'content-range': `bytes 0-${png.length - 1}/${png.length}` },
    });
    assert.fail(`Unexpected request: ${parsed.hostname}${parsed.pathname}`);
  });
  return calls;
}

test('a customer can run a live-priced two-image catalogue template through the ordinary job lifecycle', async t => {
  const calls = network(t);
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { job_id: JOB, state: 'SUBMITTED', balance_after: 500 });
  const debit = calls.find(call => call.path.endsWith('/rpc/ledger_debit'))?.body;
  assert.equal(debit.p_model_id, model.id);
  assert.equal(debit.p_credits, 97);
  assert.deepEqual(debit.p_inputs.catalog_template_billing, {
    version: 1, provider: 'seedance', catalog_id: 'seedance:1:1:42', template_id: '42',
    provider_credits: 355.2, cost_microusd: 1724272, credits: 97, resolution: '720p',
  });
  const submit = calls.find(call => call.path === '/api/v1/client/job/CreateTask')?.body;
  assert.equal(submit.model, 'bytedance/template');
  assert.deepEqual({ template_id: submit.input.template_id, resolution: submit.input.resolution }, { template_id: '42', resolution: '720p' });
  assert.deepEqual(submit.input.img_urls.map(url => decodeURIComponent(new URL(url).pathname)), SOURCES.map(key => `/test/${key}`));
  assert.ok(submit.input.img_urls.every(url => new URL(url).searchParams.has('X-Amz-Signature')));
});

test('a stale displayed price is refused before debit and provider submission', async t => {
  const calls = network(t);
  const response = await POST(request(96));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'credit_confirmation_mismatch', confirmed_credits: 96, expected_credits: 97 });
  assert.equal(calls.some(call => call.path.endsWith('/rpc/ledger_debit')), false);
  assert.equal(calls.some(call => call.path === '/api/v1/client/job/CreateTask'), false);
});
