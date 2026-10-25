import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c);}`));

const { developerApi } = await import('../lib/developerApi.js');
const { createVeyrnoxMcpServer } = await import('../lib/veyrnoxMcp.js');
const { schedulePost, MIN_LEAD_MS } = await import('../lib/publishAutomation.js');

const auth = '11111111-1111-4111-8111-111111111111';
const client = '22222222-2222-4222-8222-222222222222';
const brand = '33333333-3333-4333-8333-333333333333';
const account = '44444444-4444-4444-8444-444444444444';
const job = '55555555-5555-4555-8555-555555555555';
const post = '66666666-6666-4666-8666-666666666666';
const identity = { 'x-veyrnox-auth-id': auth, 'x-veyrnox-auth-client-id': client };
const future = () => new Date(Date.now() + 3 * 86400000).toISOString();

Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only', PUBLISH_AUTOMATION_ENABLED: 'true',
    PUBLISH_CALENDAR_ENABLED: 'true', PUBLISH_PLANS_ENABLED: 'true', PUBLISH_TEAMS_ENABLED: 'false', ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true',
    PUBLISH_RELEASED_NETWORKS: 'youtube,linkedin,twitter,tiktok', PUBLIC_HOST: 'https://veyrnox.test',
});
delete process.env.PUBLISH_RUNTIME_FLAGS;

let calls = [];
function stub(overrides = {}, tier = 'publish') {
    calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop();
        const args = JSON.parse(init.body);
        calls.push({ name, args });
        const defaults = {
            consume_account_read_request: { ok: true },
            consume_social_post_write_request: { ok: true },
            get_or_create_default_social_brand: { ok: true, brand_id: brand, label: 'Veyrnox' },
            read_social_publish_entitlement: { ok: true, tier, analytics_days: 366, best_time_enabled: true },
            list_social_accounts: { ok: true, accounts: [{ id: account, network: 'youtube', display_name: 'Chan', status: 'active', connected_at: '2026-10-01T00:00:00Z', access_token_enc: 'SECRET' }] },
            list_social_calendar: { ok: true, posts: [{ id: post, status: 'scheduled', scheduled_at: future(), updated_at: '2026-10-18T00:00:00+00:00', can_cancel: true }], next: null },
            create_social_post: { ok: true, post_id: post, idempotent: false, target_count: 1 },
            social_brand_contains_post: { ok: true },
            cancel_social_post: { ok: true, updated_at: '2026-10-18T01:00:00+00:00', idempotent: false },
            reschedule_social_post: { ok: true, scheduled_at: future(), idempotent: false },
            get_social_analytics: { ok: true, account: { id: account }, sync: { failing: false }, evolution: [{ date: '2026-10-01', metrics: { views: 1 } }, { date: '2026-10-02', metrics: { views: 5 } }], posts: [{ id: 'p1' }] },
        };
        return Response.json(overrides[name] ?? defaults[name] ?? { ok: true });
    };
}

const api = (path, init = {}) => developerApi(
    new Request(`https://veyrnox.test/api/v1/developer/publish${path}`, { ...init, headers: { ...identity, ...(init.headers || {}) } }),
    ['publish', ...path.split('?')[0].split('/').filter(Boolean)],
);
const post_ = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
const schedule = (extra = {}) => ({ scheduled_at: future(), account_ids: [account], media: [{ media_type: 'video', job_id: job }], text: 'hi', idempotency_key: 'idem-12345678', ...extra });

test('every Publish route is closed while the flag is off', async () => {
    stub();
    process.env.PUBLISH_AUTOMATION_ENABLED = 'false';
    try {
        const response = await api('/accounts');
        assert.deepEqual([response.status, await response.json()], [404, { error: 'publish_automation_not_open' }]);
        assert.equal(calls.length, 0);
    } finally { process.env.PUBLISH_AUTOMATION_ENABLED = 'true'; }
});

test('accounts are projected without token material', async () => {
    stub();
    const response = await api('/accounts');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.brand_id, brand);
    assert.equal(body.accounts[0].network, 'youtube');
    assert.equal(body.accounts[0].publishing_enabled, true);
    assert.ok(!JSON.stringify(body).includes('SECRET'));
});

test('scheduled posts come with the version stamp cancel needs', async () => {
    stub();
    const response = await api('/posts?status=scheduled');
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.posts[0].updated_at, '2026-10-18T00:00:00+00:00');
    assert.equal(calls.find((c) => c.name === 'list_social_calendar').args.p_status, 'scheduled');
});

test('the free tier cannot read the calendar: Publish Plan is enforced server side', async () => {
    stub({}, 'free');
    const response = await api('/posts');
    assert.deepEqual([response.status, (await response.json()).error], [402, 'publish_plan_required']);
});

test('scheduling forwards a future post and never publishes now', async () => {
    stub();
    const response = await post_('/posts', schedule());
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.status, 'scheduled');
    const create = calls.find((c) => c.name === 'create_social_post');
    assert.equal(create.args.p_idempotency_key, 'idem-12345678');
    assert.deepEqual(create.args.p_media, [{ media_type: 'video', job_id: job }]);
    assert.ok(Date.parse(create.args.p_scheduled_at) > Date.now() + MIN_LEAD_MS - 1000);
});

test('scheduling refuses immediate, too-soon, malformed and extra-field requests before any write', async () => {
    stub();
    const soon = await post_('/posts', schedule({ scheduled_at: new Date(Date.now() + 60000).toISOString() }));
    assert.deepEqual([soon.status, (await soon.json()).error], [400, 'schedule_too_soon']);
    const now = await post_('/posts', schedule({ publish_now: true }));
    assert.deepEqual([now.status, (await now.json()).error], [400, 'invalid_body']);
    const media = await post_('/posts', schedule({ media: [{ media_type: 'video', job_id: job, upload_id: job }] }));
    assert.equal((await media.json()).error, 'invalid_media');
    const key = await post_('/posts', schedule({ idempotency_key: 'x' }));
    assert.equal((await key.json()).error, 'invalid_idempotency_key');
    const bad = await api('/posts', { method: 'POST', body: '{' });
    assert.equal((await bad.json()).error, 'invalid_json');
    assert.equal(calls.length, 0);
});

test('a network that is not released is refused by the shared handler', async () => {
    stub({ list_social_accounts: { ok: true, accounts: [{ id: account, network: 'instagram', status: 'active' }] } });
    const response = await post_('/posts', schedule());
    assert.notEqual(response.status, 201);
    assert.equal(calls.some((c) => c.name === 'create_social_post'), false);
});

test('cancel and reschedule need the version the caller last read', async () => {
    stub();
    const cancel = await post_(`/posts/${post}/cancel`, { expected_updated_at: '2026-10-18T00:00:00+00:00' });
    assert.equal(cancel.status, 200);
    assert.equal(calls.find((c) => c.name === 'cancel_social_post').args.p_expected_updated_at, '2026-10-18T00:00:00+00:00');
    const missing = await post_(`/posts/${post}/cancel`, {});
    assert.equal((await missing.json()).error, 'invalid_body');
    const moved = await post_(`/posts/${post}/reschedule`, { scheduled_at: future(), expected_at: future() });
    assert.equal(moved.status, 200);
    stub({ cancel_social_post: { ok: false, code: 'POST_CHANGED' } });
    const stale = await post_(`/posts/${post}/cancel`, { expected_updated_at: '2026-10-18T00:00:00+00:00' });
    assert.deepEqual([stale.status, (await stale.json()).error], [409, 'POST_CHANGED']);
});

test('analytics returns period endpoints, not a misleading sum', async () => {
    stub();
    const response = await api(`/analytics?account_id=${account}&from=2026-10-01&to=2026-10-02`);
    const body = await response.json();
    assert.equal(body.days_with_data, 2);
    assert.equal(body.first_day.date, '2026-10-01');
    assert.equal(body.last_day.metrics.views, 5);
    const bad = await api('/analytics?account_id=nope&from=2026-10-01&to=2026-10-02');
    assert.equal((await bad.json()).error, 'invalid_account_id');
});

test('a supplied brand is forwarded only as the validated header', async () => {
    stub();
    const bad = await api('/accounts?brand_id=not-a-uuid');
    assert.deepEqual([bad.status, (await bad.json()).error], [400, 'invalid_brand_id']);
    assert.equal(calls.length, 0);
});

test('rate limits surface as a typed error with the wait', async () => {
    stub({ consume_account_read_request: { ok: false, code: 'RATE_LIMITED', retry_after_seconds: 7 } });
    const response = await api('/accounts');
    assert.equal(response.status, 429);
});

test('adapter rejects past times without touching the network', async () => {
    stub();
    const result = await schedulePost({ headers: new Headers(identity) }, { ...{ scheduledAt: new Date(Date.now() - 1000).toISOString(), accountIds: [account], media: [{ mediaType: 'image', jobId: job }], idempotencyKey: 'idem-12345678' } });
    assert.equal(result.body.error, 'schedule_too_soon');
    assert.equal(calls.length, 0);
});

test('MCP exposes the Publish tools only while the flag is on', () => {
    const request = { headers: new Headers(identity) };
    const names = (server) => Object.keys(server._registeredTools || {});
    const on = names(createVeyrnoxMcpServer(request));
    for (const tool of ['publish_list_accounts', 'publish_list_posts', 'publish_schedule_post', 'publish_reschedule_post', 'publish_cancel_post', 'publish_get_analytics', 'publish_list_brands']) {
        assert.ok(on.includes(tool), tool);
    }
    process.env.PUBLISH_AUTOMATION_ENABLED = 'false';
    try {
        assert.equal(names(createVeyrnoxMcpServer(request)).some((name) => name.startsWith('publish_')), false);
    } finally { process.env.PUBLISH_AUTOMATION_ENABLED = 'true'; }
});

test('MCP scheduling uses carousel admission and preserves ordered attachments', async () => {
    const prior = process.env.PUBLISH_CAROUSEL_ENABLED;
    try {
        const server = createVeyrnoxMcpServer({ headers: new Headers(identity) });
        const tool = server._registeredTools.publish_schedule_post;
        for (const enabled of ['false', 'true']) {
            process.env.PUBLISH_CAROUSEL_ENABLED = enabled;
            stub({ list_social_accounts: { ok: true, accounts: [{ id: account, network: 'twitter', status: 'active' }] } });
            const media = [{ media_type: 'image', job_id: job }, { media_type: 'image', job_id: post }];
            const result = await tool.handler(schedule({ media }), {});
            const create = calls.find(c => c.name === 'create_social_post');
            if (enabled === 'true') assert.deepEqual(create.args.p_media, media);
            else { assert.equal(create, undefined); assert.equal(result.isError, true); assert.match(JSON.stringify(result), /carousel_not_open/); }
        }
    } finally { if (prior === undefined) delete process.env.PUBLISH_CAROUSEL_ENABLED; else process.env.PUBLISH_CAROUSEL_ENABLED = prior; }
});

test('the Publish tool source never offers publish-now and imports no auth SDK', () => {
    const source = readFileSync(new URL('../lib/veyrnoxPublishMcp.js', import.meta.url), 'utf8')
        + readFileSync(new URL('../lib/publishAutomation.js', import.meta.url), 'utf8')
        + readFileSync(new URL('../lib/publishAutomationApi.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /publishNow\s*:\s*true|publish_now/);
    assert.doesNotMatch(source, /supabase-js|from 'jose'|tsx/);
});
