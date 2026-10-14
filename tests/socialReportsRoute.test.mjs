import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));

const { GET, PUT, DELETE } = await import('../app/api/v1/social/reports/route.js');
const auth = '11111111-1111-4111-8111-111111111111';
const brand = '22222222-2222-4222-8222-222222222222';
const template = '33333333-3333-4333-8333-333333333333';
const account = '44444444-4444-4444-8444-444444444444';

Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test',
  PUBLISH_REPORTS_ENABLED: 'true',
  PUBLISH_SCHEDULED_REPORTS_ENABLED: 'true',
  ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true',
});

const request = (method = 'GET', body, url = 'https://veyrnox.test/api/v1/social/reports') => new Request(url, {
  method,
  headers: { 'x-veyrnox-auth-id': auth, ...(body ? { 'content-type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

let calls = [];
function stub(overrides = {}) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const name = new URL(url).pathname.split('/').pop();
    const args = JSON.parse(init.body);
    calls.push({ name, args });
    const defaults = {
      consume_account_read_request: { ok: true },
      consume_social_post_write_request: { ok: true },
      get_or_create_default_social_brand: { ok: true, brand_id: brand },
      list_social_report_templates: {
        ok: true,
        templates: [{ id: template, name: 'Monthly client report', account_id: account, range_days: 30, compare_previous: true, include_content: true, report_title: 'October performance', accent_color: '#38bdf8' }],
      },
      save_social_report_template_v2: { ok: true, template_id: template },
      delete_social_report_template: { ok: true },
    };
    return Response.json(overrides[name] ?? defaults[name]);
  };
}

test('lists report templates for the selected brand without caching', async () => {
  stub();
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.templates[0].report_title, 'October performance');
  assert.equal(body.scheduledReportsEnabled, true);
  assert.equal(calls.at(-1).name, 'list_social_report_templates');
  assert.deepEqual(calls.at(-1).args, { p_auth_id: auth, p_brand_id: brand });
});

test('validates a report before consuming the write bucket', async () => {
  stub();
  const response = await PUT(request('PUT', { name: '', rangeDays: 30, comparePrevious: true, includeContent: true, accentColor: '#38bdf8' }));
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test('saves a bounded branded report definition', async () => {
  stub();
  const response = await PUT(request('PUT', {
    name: ' Monthly client report ', accountId: account, rangeDays: 90, comparePrevious: true,
    includeContent: false, reportTitle: ' Quarterly review ', accentColor: '#AABBCC',
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { template_id: template });
  assert.equal(calls.at(-1).name, 'save_social_report_template_v2');
  assert.deepEqual(calls.at(-1).args, {
    p_auth_id: auth, p_brand_id: brand, p_id: null, p_name: 'Monthly client report', p_account_id: account,
    p_range_days: 90, p_compare_previous: true, p_include_content: false,
    p_report_title: 'Quarterly review', p_accent_color: '#aabbcc', p_delivery_cadence: 'manual',
    p_delivery_hour_utc: null, p_delivery_weekday: null, p_delivery_day: null,
  });
});

test('saves a validated weekly report schedule', async () => {
  stub();
  const response = await PUT(request('PUT', { name: 'Weekly', rangeDays: 7, comparePrevious: true, includeContent: true,
    accentColor: '#38bdf8', deliveryCadence: 'weekly', deliveryHourUtc: 9, deliveryWeekday: 1 }));
  assert.equal(response.status, 200);
  assert.deepEqual(Object.fromEntries(Object.entries(calls.at(-1).args).filter(([key]) => key.startsWith('p_delivery'))), {
    p_delivery_cadence: 'weekly', p_delivery_hour_utc: 9, p_delivery_weekday: 1, p_delivery_day: null,
  });
  stub();
  const invalid = await PUT(request('PUT', { name: 'Bad schedule', rangeDays: 7, comparePrevious: true, includeContent: true,
    accentColor: '#38bdf8', deliveryCadence: 'monthly', deliveryHourUtc: 24, deliveryDay: 31 }));
  assert.equal(invalid.status, 400); assert.equal(calls.length, 0);
});

test('maps report conflicts and provider failures without leaking details', async () => {
  stub({ save_social_report_template_v2: { ok: false, code: 'REPORT_NAME_TAKEN' } });
  const conflict = await PUT(request('PUT', { name: 'Monthly', rangeDays: 30, comparePrevious: false, includeContent: true, accentColor: '#38bdf8' }));
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { error: 'report_name_taken' });

  globalThis.fetch = async (url) => {
    const name = new URL(url).pathname.split('/').pop();
    if (name === 'list_social_report_templates') throw new Error('database secret');
    if (name === 'get_or_create_default_social_brand') return Response.json({ ok: true, brand_id: brand });
    return Response.json({ ok: true });
  };
  const failed = await GET(request());
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: 'internal' });
});

test('deletes only a valid report template id', async () => {
  stub();
  const invalid = await DELETE(request('DELETE', null, 'https://veyrnox.test/api/v1/social/reports?id=bad'));
  assert.equal(invalid.status, 400);
  assert.equal(calls.length, 0);

  const response = await DELETE(request('DELETE', null, `https://veyrnox.test/api/v1/social/reports?id=${template}`));
  assert.equal(response.status, 200);
  assert.equal(calls.at(-1).name, 'delete_social_report_template');
  assert.equal(calls.at(-1).args.p_id, template);
});

test('feature flag fails closed after authenticating the request shape', async () => {
  const previous = process.env.PUBLISH_REPORTS_ENABLED;
  process.env.PUBLISH_REPORTS_ENABLED = 'false';
  try {
    stub();
    const response = await GET(request());
    assert.equal(response.status, 404);
    assert.equal(calls.length, 0);
  } finally {
    process.env.PUBLISH_REPORTS_ENABLED = previous;
  }
});
