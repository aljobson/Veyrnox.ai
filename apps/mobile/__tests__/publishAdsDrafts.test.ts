import { ApiError } from '../src/lib/api';
import { adsErrorKey, buildCampaignBody, canEditCampaigns, deleteCampaign, emptyForm, formFromCampaign, parseCampaignDetails, saveCampaign, type CampaignForm } from '../src/lib/publishAds';

const ID = '0a1b2c3d-1111-4222-8333-444455556666';
const POST = '0a1b2c3d-1111-4222-8333-777788889999';
const ok = (over: Partial<CampaignForm> = {}) => ({ ...emptyForm(), name: 'Launch', ...over });

describe('ad drafts: building the request', () => {
    test('a valid standalone draft becomes the body the web sends', () => {
        const r = buildCampaignBody(ok({ dailyBudget: '12.50', locations: 'UK, UK, FR', interests: ' music ', destinationUrl: 'https://shop.example.test/a' }));
        expect(r).toEqual({
            body: {
                id: null, sourcePostId: null, network: 'meta', mode: 'standalone', name: 'Launch', objective: 'awareness', dailyBudgetCents: 1250, currency: 'GBP',
                audience: { locations: ['UK', 'FR'], interests: ['music'], ageMin: 18, ageMax: 65 }, destinationUrl: 'https://shop.example.test/a', leadFormUrl: null, startsAt: null, endsAt: null,
            },
        });
    });
    test('a boost needs a real published post and a standalone drops any post', () => {
        expect(buildCampaignBody(ok({ mode: 'boost' }))).toEqual({ errorKey: 'ads.err.post' });
        expect(buildCampaignBody(ok({ mode: 'boost', sourcePostId: 'nope' }))).toEqual({ errorKey: 'ads.err.post' });
        expect(buildCampaignBody(ok({ mode: 'boost', sourcePostId: POST }))).toMatchObject({ body: { sourcePostId: POST } });
        expect(buildCampaignBody(ok({ mode: 'standalone', sourcePostId: POST }))).toMatchObject({ body: { sourcePostId: null } });
    });
    test.each([
        [{ name: '  ' }, 'ads.err.name'],
        [{ name: 'x'.repeat(121) }, 'ads.err.name'],
        [{ dailyBudget: '0.50' }, 'ads.err.budget'],
        [{ dailyBudget: 'abc' }, 'ads.err.budget'],
        [{ dailyBudget: '1000000.01' }, 'ads.err.budget'],
        [{ currency: 'GB' }, 'ads.err.currency'],
        [{ ageMin: '12' }, 'ads.err.age'],
        [{ ageMin: '40', ageMax: '30' }, 'ads.err.age'],
        [{ ageMax: '101' }, 'ads.err.age'],
        [{ destinationUrl: 'http://a.example.test' }, 'ads.err.url'],
        [{ leadFormUrl: 'javascript:alert(1)' }, 'ads.err.url'],
        [{ locations: Array.from({ length: 21 }, (_, i) => `p${i}`).join(',') }, 'ads.err.audience'],
        [{ interests: 'y'.repeat(81) }, 'ads.err.audience'],
        [{ network: 'myspace' }, 'ads.err.invalid'],
        [{ ends: new Date('2026-12-01T10:00:00Z') }, 'ads.err.dates'],
        [{ starts: new Date('2026-12-02T10:00:00Z'), ends: new Date('2026-12-01T10:00:00Z') }, 'ads.err.dates'],
    ] as [Partial<CampaignForm>, string][])('rejects %j before any request', (over, key) => {
        expect(buildCampaignBody(ok(over))).toEqual({ errorKey: key });
    });
    test('dates go out as ISO strings', () => {
        const r = buildCampaignBody(ok({ starts: new Date('2026-12-01T10:00:00Z'), ends: new Date('2026-12-05T10:00:00Z') }));
        expect(r).toMatchObject({ body: { startsAt: '2026-12-01T10:00:00.000Z', endsAt: '2026-12-05T10:00:00.000Z' } });
    });
});

describe('ad drafts: reading and editing', () => {
    const body = {
        brandRole: 'editor',
        campaigns: [{ id: ID, name: 'Launch', network: 'tiktok', mode: 'boost', source_post_id: POST, objective: 'sales', status: 'draft', daily_budget_cents: 1250, currency: 'EUR', audience: { locations: ['FR'], interests: ['film'], ageMin: 21, ageMax: 40 }, destination_url: 'https://a.example.test/x', lead_form_url: 'http://bad.example.test', starts_at: '2026-12-01T10:00:00Z' }],
    };
    test('keeps what the form needs, and drops a link that is not https', () => {
        const [c] = parseCampaignDetails(body);
        expect(c).toMatchObject({ sourcePostId: POST, locations: ['FR'], interests: ['film'], ageMin: 21, ageMax: 40, destinationUrl: 'https://a.example.test/x', leadFormUrl: null });
    });
    test('an edit round-trips through the form unchanged', () => {
        const [c] = parseCampaignDetails(body);
        const r = buildCampaignBody(formFromCampaign(c));
        expect(r).toMatchObject({ body: { id: ID, sourcePostId: POST, network: 'tiktok', mode: 'boost', dailyBudgetCents: 1250, currency: 'EUR', startsAt: '2026-12-01T10:00:00.000Z', endsAt: null } });
    });
    test('only owner, manager and editor see the edit buttons', () => {
        expect(canEditCampaigns({ brandRole: 'owner' })).toBe(true);
        expect(canEditCampaigns({ brandRole: 'editor' })).toBe(true);
        expect(canEditCampaigns({ brandRole: 'viewer' })).toBe(false);
        expect(canEditCampaigns({})).toBe(false);
        expect(canEditCampaigns(null)).toBe(false);
    });
});

describe('ad drafts: requests and errors', () => {
    test('save is a PUT of the JSON body and delete is a DELETE with an encoded id', async () => {
        const request = jest.fn().mockResolvedValue({});
        const api = { request } as never;
        const built = buildCampaignBody(ok());
        if (!('body' in built)) throw new Error('expected a body');
        await saveCampaign(api, built.body);
        expect(request).toHaveBeenCalledWith('/api/v1/social/ads', expect.objectContaining({ method: 'PUT', body: JSON.stringify(built.body) }));
        await deleteCampaign(api, 'a b');
        expect(request).toHaveBeenLastCalledWith('/api/v1/social/ads?id=a%20b', { method: 'DELETE' });
    });
    test('the web error codes map to their own messages', () => {
        expect(adsErrorKey(new ApiError(402, 'plan_required'))).toBe('ads.err.plan');
        expect(adsErrorKey(new ApiError(403, 'forbidden'))).toBe('ads.err.role');
        expect(adsErrorKey(new ApiError(409, 'campaign_not_editable'))).toBe('ads.err.notEditable');
        expect(adsErrorKey(new ApiError(409, 'campaign_limit'))).toBe('ads.err.limit');
        expect(adsErrorKey(new ApiError(404, 'post_not_found'))).toBe('ads.err.postGone');
        expect(adsErrorKey(new ApiError(404, 'ads_not_open'))).toBe('ads.err.notOpen');
        expect(adsErrorKey(new ApiError(400, 'invalid_body'))).toBe('ads.err.invalid');
        expect(adsErrorKey(new ApiError(429, 'rate_limited'))).toBe('ads.err.rate');
    });
});
