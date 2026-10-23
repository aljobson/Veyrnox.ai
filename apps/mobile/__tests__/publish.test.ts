import { ApiError, type ApiClient } from '../src/lib/api';
import {
    accountStatusLabel,
    boundedError,
    fetchAccounts,
    fetchAnalytics,
    fetchPost,
    fetchPosts,
    findPost,
    lastDays,
    mergePage,
    metricLabel,
    parseAccounts,
    parsePost,
    parseAnalytics,
    parsePosts,
    postStatusLabel,
    publishErrorMessage,
    targetStatusLabel,
} from '../src/lib/publish';

const apiWith = (result: unknown) => {
    const request = jest.fn(async (_path: string) => {
        if (result instanceof Error) throw result;
        return result;
    });
    return { api: { request } as unknown as ApiClient, request };
};

const account = { id: 'a1', network: 'instagram', display_name: 'Studio', avatar_url: 'https://cdn.example/a.jpg', status: 'active', connected_at: '2026-10-01T10:00:00Z', token_expires_at: '2026-12-01T10:00:00Z' };
const post = {
    id: 'p1',
    status: 'scheduled',
    scheduled_at: '2026-10-20T09:00:00Z',
    global_text: 'Hello world',
    created_at: '2026-10-18T10:00:00Z',
    targets: [{ id: 't1', network: 'instagram', publish_status: 'pending', platform_post_url: null, last_error: null }],
};

describe('parseAccounts', () => {
    test('reads accounts and the plan limit', () => {
        const r = parseAccounts({ brand_id: 'b', accountLimit: 5, planTier: 'publish', accounts: [account] });
        expect(r.accountLimit).toBe(5);
        expect(r.accounts[0]).toMatchObject({ id: 'a1', network: 'instagram', displayName: 'Studio', status: 'active' });
    });
    test('drops entries without an id or network, and non-https avatars', () => {
        const r = parseAccounts({ accounts: [{ ...account, id: '' }, { ...account, network: 5 }, { ...account, avatar_url: 'http://x/a.jpg' }] });
        expect(r.accounts).toHaveLength(1);
        expect(r.accounts[0].avatarUrl).toBeNull();
    });
    test('an unusable body gives an empty list and a limit of one', () => {
        expect(parseAccounts(null)).toMatchObject({ accountLimit: 1, accounts: [], uploadsEnabled: false, brandId: null, brandRole: 'viewer', planTier: 'free' });
    });
});

describe('parsePosts', () => {
    test('reads posts with their targets', () => {
        const [p] = parsePosts({ posts: [post] });
        expect(p).toMatchObject({ id: 'p1', status: 'scheduled', text: 'Hello world' });
        expect(p.targets[0]).toMatchObject({ id: 't1', network: 'instagram', publishStatus: 'pending', url: null, lastError: null });
    });
    test('keeps only https post links', () => {
        const [p] = parsePosts({ posts: [{ ...post, targets: [{ ...post.targets[0], platform_post_url: 'javascript:alert(1)' }, { ...post.targets[0], id: 't2', platform_post_url: 'https://instagram.com/p/x' }] }] });
        expect(p.targets.map((t) => t.url)).toEqual([null, 'https://instagram.com/p/x']);
    });
    test('drops posts without an id and tolerates missing targets', () => {
        expect(parsePosts({ posts: [{ ...post, id: undefined }] })).toEqual([]);
        expect(parsePosts({ posts: [{ ...post, targets: undefined }] })[0].targets).toEqual([]);
    });
});

describe('wording', () => {
    test('post statuses', () => {
        expect(postStatusLabel('scheduled')).toBe('Scheduled');
        expect(postStatusLabel('published')).toBe('Published');
        expect(postStatusLabel('failed')).toBe('Failed');
        expect(postStatusLabel('canceled')).toBe('Canceled');
        expect(postStatusLabel('draft')).toBe('Draft');
        expect(postStatusLabel('zzz')).toBe('Unknown');
    });
    test('target statuses', () => {
        expect(targetStatusLabel('pending')).toBe('Waiting');
        expect(targetStatusLabel('publishing')).toBe('Publishing');
        expect(targetStatusLabel('submitted')).toBe('Sent to the network');
        expect(targetStatusLabel('delivered')).toBe('Delivered');
        expect(targetStatusLabel('published')).toBe('Published');
        expect(targetStatusLabel('failed')).toBe('Failed');
    });
    test('account statuses say what to do when one needs attention', () => {
        expect(accountStatusLabel('active')).toBe('Connected');
        expect(accountStatusLabel('expired')).toBe('Needs to be reconnected');
        expect(accountStatusLabel('revoked')).toBe('Access was removed');
        expect(accountStatusLabel('error')).toBe('Needs attention');
    });
});

describe('boundedError', () => {
    test('is null when empty and strips control characters', () => {
        expect(boundedError(null)).toBeNull();
        expect(boundedError('  ')).toBeNull();
        expect(boundedError('bad\u0000 thing\u0007')).toBe('bad thing');
    });
    test('cuts a long provider message to 300 characters', () => {
        const out = boundedError('x'.repeat(900)) as string;
        expect(out.length).toBeLessThanOrEqual(301);
        expect(out.endsWith('…')).toBe(true);
    });
});

describe('parseAnalytics', () => {
    test('reads the account, sync state, daily metrics and posts', () => {
        const a = parseAnalytics({ account: { id: 'a1', network: 'instagram', display_name: 'Studio', status: 'active' }, sync: { last_ok_at: '2026-10-18T00:00:00Z', failing: false }, evolution: [{ date: '2026-10-17', metrics: { followers: 10, reach: 200 } }], posts: [{ id: 'x', published_at: '2026-10-17T00:00:00Z', type: 'reel', permalink: 'https://i.example/x', caption: 'cap', metrics: { likes: 4 } }] });
        expect(a.account?.displayName).toBe('Studio');
        expect(a.syncFailing).toBe(false);
        expect(a.days[0]).toEqual({ date: '2026-10-17', metrics: { followers: 10, reach: 200 } });
        expect(a.posts[0]).toMatchObject({ id: 'x', caption: 'cap', link: 'https://i.example/x' });
    });
    test('keeps only numeric metrics', () => {
        const a = parseAnalytics({ evolution: [{ date: '2026-10-17', metrics: { followers: 10, name: 'x', bad: NaN } }] });
        expect(a.days[0].metrics).toEqual({ followers: 10 });
    });
    test('an unusable body is empty', () => {
        expect(parseAnalytics(null)).toMatchObject({ account: null, days: [], posts: [] });
    });
});

describe('fetchers', () => {
    test('fetchAccounts reads GET /api/v1/social/accounts', async () => {
        const { api, request } = apiWith({ accounts: [account] });
        expect((await fetchAccounts(api)).accounts).toHaveLength(1);
        expect(request).toHaveBeenCalledWith('/api/v1/social/accounts');
    });
    test('fetchPosts sends the cursor as the server expects it', async () => {
        const { api, request } = apiWith({ posts: [post] });
        await fetchPosts(api, { createdAt: '2026-10-18T10:00:00Z', id: 'p1' });
        const path = String(request.mock.calls[0][0]);
        expect(path).toContain('/api/v1/social/posts?');
        expect(path).toContain('before_created_at=2026-10-18T10%3A00%3A00Z');
        expect(path).toContain('before_id=p1');
    });
    test('fetchAnalytics encodes the account and dates', async () => {
        const { api, request } = apiWith({});
        await fetchAnalytics(api, 'a/1', '2026-09-01', '2026-10-01');
        expect(String(request.mock.calls[0][0])).toBe('/api/v1/social/analytics?accountId=a%2F1&from=2026-09-01&to=2026-10-01');
    });
});

describe('findPost', () => {
    test('finds a post by id in a list', () => {
        const posts = parsePosts({ posts: [post] });
        expect(findPost(posts, 'p1')?.id).toBe('p1');
        expect(findPost(posts, 'nope')).toBeNull();
    });
});

describe('publishErrorMessage', () => {
    test('402 names the plan, 404 an account that is gone, 429 asks to wait', () => {
        expect(publishErrorMessage(new ApiError(402, 'publish_plan_required'))).toMatch(/Publish Plan/);
        expect(publishErrorMessage(new ApiError(404, 'account_not_found'))).toMatch(/no longer/);
        expect(publishErrorMessage(new ApiError(429, 'rate_limited'))).toMatch(/Try again in a moment/);
    });
    test('offline and everything else get plain wording', () => {
        expect(publishErrorMessage(new ApiError(0, 'network'))).toMatch(/connection/);
        expect(publishErrorMessage(new Error('x'))).toMatch(/Could not load/);
    });
});

describe('lastDays and metricLabel', () => {
    test('a 30 day range ends today and is inclusive', () => {
        expect(lastDays(30, new Date('2026-10-18T12:00:00Z'))).toEqual({ from: '2026-09-19', to: '2026-10-18' });
        expect(lastDays(1, new Date('2026-10-18T12:00:00Z'))).toEqual({ from: '2026-10-18', to: '2026-10-18' });
    });
    test('metric keys read as words', () => {
        expect(metricLabel('video_views')).toBe('Video views');
        expect(metricLabel('reach')).toBe('Reach');
    });
});

describe('mergePage', () => {
    test('appends only posts not already shown', () => {
        const a = parsePosts({ posts: [post] });
        const b = parsePosts({ posts: [post, { ...post, id: 'p2' }] });
        const r = mergePage(a, b);
        expect(r.posts.map((p) => p.id)).toEqual(['p1', 'p2']);
        expect(r.added).toBe(true);
    });
    test('a page that repeats what is shown adds nothing, which stops paging', () => {
        const a = parsePosts({ posts: [post] });
        expect(mergePage(a, a)).toMatchObject({ added: false });
        expect(mergePage(a, a).posts).toHaveLength(1);
    });
});

describe('parsePost and fetchPost', () => {
    test('a single row keeps updated_at, which cancel and restore need', () => {
        const p = parsePost({ ...post, updated_at: '2026-10-18T10:05:00Z' });
        expect(p?.updatedAt).toBe('2026-10-18T10:05:00Z');
        expect(parsePost({ ...post })?.updatedAt).toBeNull();
        expect(parsePost(null)).toBeNull();
        expect(parsePost({ ...post, id: '' })).toBeNull();
    });
    test('fetchPost reads GET /social/posts/:id and unwraps the row', async () => {
        const { api, request } = apiWith({ brand_id: 'b', post: { ...post, updated_at: 'u1' } });
        const p = await fetchPost(api, 'a/b');
        expect(request).toHaveBeenCalledWith('/api/v1/social/posts/a%2Fb');
        expect(p?.updatedAt).toBe('u1');
    });
    test('fetchPost gives null for an unusable answer and throws on a server error', async () => {
        expect(await fetchPost(apiWith({}).api, 'p1')).toBeNull();
        await expect(fetchPost(apiWith(new ApiError(404, 'not_found')).api, 'p1')).rejects.toBeInstanceOf(ApiError);
    });
});


test('uploads flag is strictly true; all existing account fields are unchanged', () => {
    const body = { accountLimit: 5, accounts: [account] };
    for (const flag of [undefined, null, false, 'true', 1]) expect(parseAccounts({ ...body, uploadsEnabled: flag }).uploadsEnabled).toBe(false);
    const { uploadsEnabled, ...rest } = parseAccounts({ ...body, uploadsEnabled: true });
    expect(uploadsEnabled).toBe(true);
    expect(rest).toMatchObject({ accountLimit: 5, accounts: [{ id: 'a1', network: 'instagram', displayName: 'Studio', avatarUrl: 'https://cdn.example/a.jpg', status: 'active', connectedAt: '2026-10-01T10:00:00Z', tokenExpiresAt: '2026-12-01T10:00:00Z', publishingEnabled: false, supportedMedia: [] }] });
});

test('account capability, plan and role fields are parsed strictly for the dashboard', () => {
    const parsed = parseAccounts({
        brand_id: 'brand-1', brandRole: 'reviewer', planTier: 'publish', plansEnabled: true,
        inboxEnabled: true, approvalsEnabled: true, teamsEnabled: 'true', customerApiEnabled: 1,
    });
    expect(parsed).toMatchObject({ brandId: 'brand-1', brandRole: 'reviewer', planTier: 'publish', plansEnabled: true });
    expect(parsed.features).toMatchObject({ inbox: true, approvals: true, teams: false, customerApi: false });
});
