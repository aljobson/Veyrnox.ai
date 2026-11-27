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
const EIGHT_SOURCES = Array.from({ length: 8 }, (_, index) =>
  `uploads/${AUTH}/33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}.png`);
const NINE_SOURCES = [...EIGHT_SOURCES, `uploads/${AUTH}/33333333-3333-4333-8333-000000000009.png`];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==', 'base64');
const model = {
  id: 'crun-catalog-seedance-template', provider: 'crun', provider_endpoint: 'crun:bytedance/template',
  modality: 'image-to-video', credits_5s: 170, provider_cost_per_unit: 3.0355, cost_unit: 'per_generation',
  active: true, gated_flag: false,
};

const request = (credits = 97, {
  sources = SOURCES, provider = 'seedance', catalogId = 'seedance:1:1:42', resolution = '720p', key = 'seedance-catalog-template',
} = {}) => new Request('https://veyrnox.test/api/v1/generations', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-veyrnox-auth-id': AUTH },
  body: JSON.stringify({
    model_id: 'catalog-template', idempotency_key: key, confirmed_credits: credits,
    consent: sources.length > 0, inputs: {}, source_keys: sources.map(source => ({ slot: 'image', key: source })),
    catalog_template: { provider, catalog_id: catalogId, ...(resolution ? { resolution } : {}) },
  }),
});

function network(t, { inputNum = 2, credit = 355.2, failSubmit = false, modelRow = model } = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const parsed = new URL(String(url));
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: parsed.href, path: parsed.pathname, body });
    if (parsed.pathname.endsWith('/rpc/check_generation_rate_limit')) return Response.json({ ok: true });
    if (parsed.pathname.endsWith('/rpc/ledger_debit')) return Response.json({ ok: true, job_id: JOB, idempotent: false, balance_after: 500 });
    if (parsed.pathname.includes('/rpc/')) return Response.json({ ok: true });
    if (parsed.pathname === '/rest/v1/model_catalog') return Response.json([modelRow]);
    if (parsed.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
    if (parsed.pathname === '/api/v1/client/job/bytedance-templates') return Response.json({
      code: 200, data: { total: 1, templates: [{
        TemplateId: '42', Title_en: 'Two-person dance', InputNum: inputNum,
        ConsumeItems: [{ Resolution: '720p', Credit: credit }],
      }] },
    });
    if (parsed.pathname === '/api/v1/client/job/vidu-templates') return Response.json({
      code: 200, data: { total: 1, templates: [{
        template: 'text_only', name: 'Text only effect', credits: 28.8,
        input_instruction: JSON.stringify({ image_count: 'No need to upload pictures.' }),
      }] },
    });
    if (parsed.pathname === '/api/v1/client/job/CreateTask') return failSubmit
      ? Response.json({ code: 400, message: 'request refused', data: null })
      : Response.json({ code: 200, data: { task_id: 'catalog-task-1' } });
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

test('an eight-image template preserves image order through the complete gateway', async t => {
  const calls = network(t, { inputNum: 8, credit: 256.47 });
  const response = await POST(request(70, { sources: EIGHT_SOURCES, key: 'seedance-eight-images' }));
  assert.equal(response.status, 200);
  const debit = calls.find(call => call.path.endsWith('/rpc/ledger_debit'))?.body;
  assert.equal(debit.p_credits, 70);
  const submit = calls.find(call => call.path === '/api/v1/client/job/CreateTask')?.body;
  assert.deepEqual(submit.input.img_urls.map(url => decodeURIComponent(new URL(url).pathname)), EIGHT_SOURCES.map(key => `/test/${key}`));
});

test('a ninth image is refused before debit or submission', async t => {
  const calls = network(t, { inputNum: 8, credit: 256.47 });
  const response = await POST(request(70, { sources: NINE_SOURCES, key: 'seedance-nine-images' }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'catalog_template_image_count' });
  assert.equal(calls.some(call => call.path.endsWith('/rpc/ledger_debit')), false);
  assert.equal(calls.some(call => call.path === '/api/v1/client/job/CreateTask'), false);
});

test('a zero-image Vidu template can generate without uploads', async t => {
  const viduModel = { ...model, id: 'crun-catalog-vidu-template', provider_endpoint: 'crun:vidu/template', credits_5s: 8, provider_cost_per_unit: 0.139806 };
  const calls = network(t, { modelRow: viduModel });
  const response = await POST(request(8, {
    sources: [], provider: 'vidu', catalogId: 'vidu:1:1:text_only', resolution: '', key: 'vidu-zero-images',
  }));
  assert.equal(response.status, 200);
  const submit = calls.find(call => call.path === '/api/v1/client/job/CreateTask')?.body;
  assert.deepEqual(submit.input.images, []);
  assert.equal(submit.input.template, 'text_only');
});

test('a rejected template submission refunds the committed debit', async t => {
  const calls = network(t, { failSubmit: true });
  const response = await POST(request(97, { key: 'seedance-submit-refund' }));
  assert.equal(response.status, 502);
  const refund = calls.find(call => call.path.endsWith('/rpc/ledger_refund'))?.body;
  assert.deepEqual(refund, { p_job_id: JOB, p_user_id: AUTH, p_credits: 97, p_reason: 'refund:submit_failed' });
});
