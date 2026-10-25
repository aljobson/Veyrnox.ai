import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { GET, POST } = await import('../app/api/v1/social/posts/route.js');
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only', ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true',
});
const auth = '11111111-1111-4111-8111-111111111111';
const brandId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const postId = '55555555-5555-4555-8555-555555555555';
const ownerAuth = '66666666-6666-4666-8666-666666666666';

const getRequest = (headers = {}, search = '') => new Request(`https://veyrnox.test/api/v1/social/posts${search}`, {
    headers: { 'x-veyrnox-auth-id': auth, ...headers },
});
const postRequest = (body, headers = {}) => new Request('https://veyrnox.test/api/v1/social/posts', {
    method: 'POST', headers: { 'x-veyrnox-auth-id': auth, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
});
const validBody = () => ({
    scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    globalText: 'hello world',
    idempotencyKey: 'a'.repeat(16),
    accountIds: [accountId],
    media: [{ mediaType: 'image', jobId }],
});

test('carousel admission rejects scheduled posts before the writer and names a blocking network', async () => {
    const prior = process.env.PUBLISH_CAROUSEL_ENABLED;
    try {
            process.env.PUBLISH_CAROUSEL_ENABLED = 'false'; stub();
            const body = { ...validBody(), media: [validBody().media[0], { mediaType: 'image', jobId: postId }] };
            const res = await POST(postRequest(body));
            assert.equal(res.status, 400);
            assert.equal((await res.json()).error, 'carousel_not_open');
            assert.equal(calls.some(c => c.name.startsWith('create_social_post')), false);
        process.env.PUBLISH_CAROUSEL_ENABLED = 'true';
        stub({ list_social_accounts: { ok: true, accounts: [{ id: accountId, network: 'twitter', status: 'active' }] } });
        const blocked = await POST(postRequest({ ...validBody(), media: Array.from({ length: 5 }, () => validBody().media[0]) }));
        assert.deepEqual(await blocked.json(), { error: 'media_count_not_supported', network: 'twitter' });
        assert.equal(calls.some(c => c.name.startsWith('create_social_post')), false);
    } finally { if (prior === undefined) delete process.env.PUBLISH_CAROUSEL_ENABLED; else process.env.PUBLISH_CAROUSEL_ENABLED = prior; }
});

test('POST: only the verified TikTok review subject can queue a sandbox image', async () => {
    const names = ['PUBLISH_RELEASED_NETWORKS', 'TIKTOK_REVIEW_ENABLED', 'TIKTOK_REVIEW_AUTH_IDS'];
    const previous = names.map(k => process.env[k]);
    Object.assign(process.env, { PUBLISH_RELEASED_NETWORKS: 'youtube,linkedin', TIKTOK_REVIEW_ENABLED: 'true', TIKTOK_REVIEW_AUTH_IDS: auth });
    try {
        for (const identity of [auth, '99999999-9999-4999-8999-999999999999']) {
            stub({ list_social_accounts: { ok: true, accounts: [{ id: accountId, network: 'tiktok', status: 'active' }] } });
            const res = await POST(postRequest(validBody(), { 'x-veyrnox-auth-id': identity }));
            assert.equal(res.status, identity === auth ? 201 : 400);
            assert.equal(calls.some(c => c.name === 'create_social_post'), identity === auth);
        }
    } finally { names.forEach((k, i) => { if (previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i]; }); }
});

let calls;
function stub(results = {}) {
    calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop();
        calls.push({ name, args: JSON.parse(init.body) });
        const result = results[name] ?? ({
            consume_account_read_request: { ok: true },
            consume_social_post_write_request: { ok: true },
            get_or_create_default_social_brand: { ok: true, idempotent: true, brand_id: brandId, label: 'My Brand', timezone: 'UTC' },
            list_social_posts: { ok: true, posts: [] },
            list_social_accounts: { ok: true, accounts: [{ id: accountId, network: 'instagram', status: 'active' }] },
            create_social_post: { ok: true, idempotent: false, post_id: postId, target_count: 1 },
            read_social_publish_entitlement: { ok: true, tier: 'publish', account_limit: 5, analytics_days: 366, best_time_enabled: true, subscription: { id: 'paid' } },
        })[name];
        if (result instanceof Error) throw result;
        return Response.json(result);
    };
}

test('GET: missing or malformed identity never reaches the database', async () => {
    stub();
    for (const identity of ['', 'bad']) {
        assert.equal((await GET(getRequest({ 'x-veyrnox-auth-id': identity }))).status, 401);
    }
    assert.deepEqual(calls, []);
});

test('GET: auto-creates the brand and lists posts', async () => {
    stub({ list_social_posts: { ok: true, posts: [{ id: postId, status: 'scheduled' }] } });
    const res = await GET(getRequest());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.brand_id, brandId);
    assert.equal(body.posts.length, 1);
    assert.deepEqual(calls[2], {
        name: 'list_social_posts',
        args: { p_auth_id: auth, p_brand_id: brandId, p_limit: 24, p_before_created_at: null, p_before_id: null },
    });
});

test('GET: paginates via before_created_at/before_id query params', async () => {
    stub();
    const before = '2026-01-01T00:00:00.000Z';
    await GET(getRequest({}, `?before_created_at=${encodeURIComponent(before)}&before_id=${postId}`));
    assert.deepEqual(calls[2].args, { p_auth_id: auth, p_brand_id: brandId, p_limit: 24, p_before_created_at: before, p_before_id: postId });
});

test('GET: accepts a bounded library limit and rejects anything outside 1..50', async () => {
    stub();
    assert.equal((await GET(getRequest({}, '?limit=50'))).status, 200);
    assert.equal(calls[2].args.p_limit, 50);
    for (const limit of ['0', '51', '2.5', 'nope']) {
        stub();
        const res = await GET(getRequest({}, `?limit=${limit}`));
        assert.equal(res.status, 400, limit);
        assert.deepEqual(await res.json(), { error: 'invalid_limit' });
        assert.equal(calls.some((call) => call.name === 'list_social_posts'), false);
    }
});

test('GET: a malformed cursor is rejected before any list RPC', async () => {
    stub();
    const res = await GET(getRequest({}, '?before_id=not-a-uuid'));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'invalid_cursor' });
});

test('GET: rate limiting stops the request before any RPC call', async () => {
    stub({ consume_account_read_request: { ok: false, code: 'RATE_LIMITED', retry_after_seconds: 45 } });
    const res = await GET(getRequest());
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '45');
    assert.equal(calls.length, 1);
});

test('POST: rejects malformed bodies before consuming any rate-limit budget or RPC call', async () => {
    stub();
    const bad = [
        { ...validBody(), scheduledAt: 'not-a-date' },
        { ...validBody(), publishNow: 'true' },
        { ...validBody(), idempotencyKey: 'short' },
        { ...validBody(), accountIds: [] },
        { ...validBody(), accountIds: ['not-a-uuid'] },
        { ...validBody(), media: [] },
        { ...validBody(), media: [{ mediaType: 'audio', jobId }] },
        { ...validBody(), media: [{ mediaType: 'image', jobId: 'not-a-uuid' }] },
        { ...validBody(), globalText: 'x'.repeat(4001) },
    ];
    for (const body of bad) {
        const res = await POST(postRequest(body));
        assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.deepEqual(calls, []);
});

test('POST: rejects an already-past schedule through the idempotency-aware database contract', async () => {
    stub({ create_social_post: { ok: false, code: 'INVALID_SCHEDULE' } });
    const res = await POST(postRequest({ ...validBody(), scheduledAt: new Date(Date.now() - 10 * 60_000).toISOString() }));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'INVALID_SCHEDULE' });
    assert.equal(calls.some((call) => call.name === 'create_social_post'), true);
});

test('POST: a past exact replay can still recover the original idempotent result', async () => {
    stub({ create_social_post: { ok: true, idempotent: true, post_id: postId, target_count: 1 } });
    const res = await POST(postRequest({ ...validBody(), scheduledAt: new Date(Date.now() - 60_000).toISOString() }));
    assert.equal(res.status, 201);
    assert.equal((await res.json()).idempotent, true);
    assert.equal(calls.some((call) => call.name === 'create_social_post'), true);
});

test('POST: missing or malformed identity never reaches the database', async () => {
    stub();
    for (const identity of ['', 'bad']) {
        assert.equal((await POST(postRequest(validBody(), { 'x-veyrnox-auth-id': identity }))).status, 401);
    }
    assert.deepEqual(calls, []);
});

test('POST: write rate limiting stops the request before any RPC call', async () => {
    stub({ consume_social_post_write_request: { ok: false, code: 'RATE_LIMITED', retry_after_seconds: 12 } });
    const res = await POST(postRequest(validBody()));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '12');
    assert.equal(calls.length, 1);
});

test('POST: schedules a post and returns its id', async () => {
    stub();
    const reqBody = validBody();
    const res = await POST(postRequest(reqBody));
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.post_id, postId);
    assert.equal(body.target_count, 1);
    const create = calls.find((c) => c.name === 'create_social_post');
    assert.deepEqual(create.args, {
        p_auth_id: auth, p_brand_id: brandId,
        p_scheduled_at: reqBody.scheduledAt, p_global_text: 'hello world',
        p_idempotency_key: 'a'.repeat(16), p_account_ids: [accountId],
        p_media: [{ media_type: 'image', job_id: jobId }],
    });
});

test('POST: paid platform variants use the atomic options RPC', async () => {
    const previousVariants = process.env.PUBLISH_CONTENT_VARIANTS_ENABLED;
    const previousPlans = process.env.PUBLISH_PLANS_ENABLED;
    process.env.PUBLISH_CONTENT_VARIANTS_ENABLED = 'true';
    process.env.PUBLISH_PLANS_ENABLED = 'true';
    try {
        stub({ create_social_post_with_options: { ok: true, idempotent: false, post_id: postId, target_count: 1 } });
        const res = await POST(postRequest({ ...validBody(), networkText: { instagram: 'Instagram copy' } }));
        assert.equal(res.status, 201);
        const create = calls.find((call) => call.name === 'create_social_post_with_options');
        assert.deepEqual(create.args.p_network_text, { instagram: 'Instagram copy' });
        assert.equal(create.args.p_youtube_visibility, null);
    } finally {
        if (previousVariants === undefined) delete process.env.PUBLISH_CONTENT_VARIANTS_ENABLED; else process.env.PUBLISH_CONTENT_VARIANTS_ENABLED = previousVariants;
        if (previousPlans === undefined) delete process.env.PUBLISH_PLANS_ENABLED; else process.env.PUBLISH_PLANS_ENABLED = previousPlans;
    }
});

test('POST: platform variants fail closed and cannot target an unselected network', async () => {
    stub();
    let res = await POST(postRequest({ ...validBody(), networkText: { instagram: 'Instagram copy' } }));
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'variants_not_open' });
    assert.deepEqual(calls, []);

    process.env.PUBLISH_CONTENT_VARIANTS_ENABLED = 'true';
    process.env.PUBLISH_PLANS_ENABLED = 'true';
    try {
        stub();
        res = await POST(postRequest({ ...validBody(), networkText: { twitter: 'Not selected' } }));
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { error: 'invalid_network_text' });
        assert.equal(calls.some((call) => call.name === 'create_social_post_with_options'), false);

        stub({ read_social_publish_entitlement: { ok: true, tier: 'free', account_limit: 1, analytics_days: 0, best_time_enabled: false, subscription: null } });
        res = await POST(postRequest({ ...validBody(), publishNow: true, networkText: { instagram: 'Paid copy' } }));
        assert.equal(res.status, 402);
        assert.deepEqual(await res.json(), { error: 'publish_plan_required', feature: 'platform_variants' });
    } finally {
        delete process.env.PUBLISH_CONTENT_VARIANTS_ENABLED;
        delete process.env.PUBLISH_PLANS_ENABLED;
    }
});

test('POST: an editor reads owner-scoped account data but creates as the acting teammate', async () => {
    const previousTeams = process.env.PUBLISH_TEAMS_ENABLED;
    const previousPlans = process.env.PUBLISH_PLANS_ENABLED;
    process.env.PUBLISH_TEAMS_ENABLED = 'true';
    process.env.PUBLISH_PLANS_ENABLED = 'true';
    try {
        stub({ get_social_brand_access: { ok: true, brand_id: brandId, label: 'Studio', role: 'editor', owner_auth_id: ownerAuth, paid: true } });
        const res = await POST(postRequest(validBody(), { 'x-publish-brand-id': brandId }));
        assert.equal(res.status, 201);
        assert.equal(calls.find((call) => call.name === 'read_social_publish_entitlement').args.p_auth_id, ownerAuth);
        assert.equal(calls.find((call) => call.name === 'list_social_accounts').args.p_auth_id, ownerAuth);
        assert.equal(calls.find((call) => call.name === 'create_social_post').args.p_auth_id, auth);

        stub({ get_social_brand_access: { ok: true, brand_id: brandId, label: 'Studio', role: 'analyst', owner_auth_id: ownerAuth, paid: true } });
        const blocked = await POST(postRequest(validBody(), { 'x-publish-brand-id': brandId }));
        assert.equal(blocked.status, 403);
        assert.equal(calls.some((call) => call.name === 'create_social_post'), false);
    } finally {
        if (previousTeams === undefined) delete process.env.PUBLISH_TEAMS_ENABLED; else process.env.PUBLISH_TEAMS_ENABLED = previousTeams;
        if (previousPlans === undefined) delete process.env.PUBLISH_PLANS_ENABLED; else process.env.PUBLISH_PLANS_ENABLED = previousPlans;
    }
});

test('POST: Post now uses server time and ignores a missing or invalid device schedule', async () => {
    for (const scheduledAt of [undefined, 'not-a-date', new Date(Date.now() - 60_000).toISOString(), '2099-01-01T00:00:00Z']) {
        stub();
        const start = Date.now();
        const res = await POST(postRequest({ ...validBody(), publishNow: true, scheduledAt }));
        assert.equal(res.status, 201);
        const create = calls.find((c) => c.name === 'create_social_post');
        const time = Date.parse(create.args.p_scheduled_at);
        assert.ok(time >= start && time <= Date.now());
        assert.equal(create.args.p_idempotency_key, 'a'.repeat(16));
    }
});

test('POST: Free can post now but scheduling requires the Publish Plan', async () => {
    const previous = process.env.PUBLISH_PLANS_ENABLED;
    process.env.PUBLISH_PLANS_ENABLED = 'true';
    try {
        const free = { ok: true, tier: 'free', account_limit: 1, analytics_days: 0, best_time_enabled: false, subscription: null };
        stub({ read_social_publish_entitlement: free });
        const blocked = await POST(postRequest(validBody()));
        assert.equal(blocked.status, 402);
        assert.deepEqual(await blocked.json(), { error: 'publish_plan_required', feature: 'scheduling' });
        assert.ok(!calls.some((call) => call.name === 'create_social_post'));

        stub({ read_social_publish_entitlement: free });
        assert.equal((await POST(postRequest({ ...validBody(), publishNow: true }))).status, 201);

        stub({ read_social_publish_entitlement: free });
        const multiple = await POST(postRequest({ ...validBody(), publishNow: true, accountIds: [accountId, '66666666-6666-4666-8666-666666666666'] }));
        assert.equal(multiple.status, 402);
        assert.deepEqual(await multiple.json(), { error: 'publish_plan_required', feature: 'multiple_accounts' });
    } finally {
        if (previous === undefined) delete process.env.PUBLISH_PLANS_ENABLED;
        else process.env.PUBLISH_PLANS_ENABLED = previous;
    }
});

test('POST: explicit scheduled mode still requires a valid schedule', async () => {
    stub();
    assert.equal((await POST(postRequest({ ...validBody(), publishNow: false, scheduledAt: undefined }))).status, 400);
    assert.deepEqual(calls, []);
});

test('POST: maps RPC failure codes to the right HTTP status', async () => {
    const cases = [
        ['USER_NOT_FOUND', 401],
        ['BRAND_NOT_FOUND', 404],
        ['ACCOUNT_NOT_FOUND', 404],
        ['MEDIA_NOT_FOUND', 404],
        ['INVALID_SCHEDULE', 400],
        ['NO_TARGET_ACCOUNTS', 400],
    ];
    for (const [code, status] of cases) {
        stub({ create_social_post: { ok: false, code } });
        const res = await POST(postRequest(validBody()));
        assert.equal(res.status, status, code);
        assert.deepEqual(await res.json(), { error: code });
    }
});

test('POST: an RPC failure never leaks upstream detail', async () => {
    stub({ create_social_post: new Error('secret upstream detail') });
    const res = await POST(postRequest(validBody()));
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'internal' });
});

test('GET advertises the calendar only while its exact feature switch is true', async () => {
    try {
        for (const value of ['false','TRUE','true']) {
            process.env.PUBLISH_CALENDAR_ENABLED=value;stub();
            assert.equal((await (await GET(getRequest())).json()).calendarEnabled,value==='true'?true:undefined);
        }
    } finally { delete process.env.PUBLISH_CALENDAR_ENABLED; }
});

test('POST: uploads require the switch and exactly one source', async () => {
    const oldPublish = process.env.PUBLISH_ENABLED, oldUploads = process.env.PUBLISH_UPLOADS_ENABLED;
    try {
        process.env.PUBLISH_ENABLED = 'true'; process.env.PUBLISH_UPLOADS_ENABLED = 'false';
        stub();
        const body = { ...validBody(), media:[{ mediaType:'image',uploadId:jobId }] };
        assert.equal((await POST(postRequest(body))).status,400); assert.equal(calls.length,0);
        process.env.PUBLISH_UPLOADS_ENABLED = 'true';
        assert.equal((await POST(postRequest({ ...body,media:[{ mediaType:'image',jobId,uploadId:jobId }] }))).status,400);
        assert.equal((await POST(postRequest(body))).status,201);
        assert.deepEqual(calls.find((c) => c.name === 'create_social_post').args.p_media,[{ media_type:'image',upload_id:jobId }]);
    } finally {
        if (oldPublish === undefined) delete process.env.PUBLISH_ENABLED; else process.env.PUBLISH_ENABLED = oldPublish;
        if (oldUploads === undefined) delete process.env.PUBLISH_UPLOADS_ENABLED; else process.env.PUBLISH_UPLOADS_ENABLED = oldUploads;
    }
});

test('release restriction rejects an existing unreleased account before creating a post', async () => {
    process.env.PUBLISH_RELEASED_NETWORKS = 'youtube';
    try {
        stub();
        const res = await POST(postRequest(validBody()));
        assert.equal(res.status, 400);
        assert.equal((await res.json()).error, 'network_unavailable');
        assert.equal(calls.some(c => c.name === 'create_social_post'), false);
    } finally { delete process.env.PUBLISH_RELEASED_NETWORKS; }
});

test('YouTube visibility fails closed while its migration switch is off', async () => {
    stub();
    const res = await POST(postRequest({ ...validBody(), youtubeVisibility: 'private' }));
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'youtube_visibility_not_open');
    assert.deepEqual(calls, []);
});

test('YouTube visibility uses the atomic RPC and rejects unknown values', async () => {
    process.env.PUBLISH_YOUTUBE_VISIBILITY_ENABLED = 'true';
    try {
        for (const visibility of ['private', 'unlisted', 'public']) {
            stub({ create_social_post_with_youtube_visibility: { ok: true, post_id: postId } });
            const res = await POST(postRequest({ ...validBody(), youtubeVisibility: visibility }));
            assert.equal(res.status, 201);
            assert.equal(calls.at(-1).name, 'create_social_post_with_youtube_visibility');
            assert.equal(calls.at(-1).args.p_youtube_visibility, visibility);
        }
        for (const visibility of [null, '', 'PRIVATE', 'unknown', {}, 1]) {
            stub();
            assert.equal((await POST(postRequest({ ...validBody(), youtubeVisibility: visibility }))).status, 400);
            assert.deepEqual(calls, []);
        }
    } finally { delete process.env.PUBLISH_YOUTUBE_VISIBILITY_ENABLED; }
});
