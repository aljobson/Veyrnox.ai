import { ApiError, type ApiClient } from '../src/lib/api';
import { sourceFrom } from '../src/lib/publishPlan';
import { EMPTY, parseSmartlink, publicUrl, saveSmartlink, slugFrom, smartlinkErrorKey, validateSmartlink, type SmartLink } from '../src/lib/publishSmartlink';

const link = (o: Partial<SmartLink> = {}): SmartLink => ({ ...EMPTY, slug: 'my-studio', title: 'Studio', items: [{ id: null, label: 'Shop', url: 'https://example.test/shop', enabled: true, clicks: 0 }], ...o });

describe('plan source', () => {
    test('reads only the two known values', () => {
        expect(sourceFrom({ entitlement: { subscription: { source: 'stripe' } } })).toBe('stripe');
        expect(sourceFrom({ entitlement: { subscription: { source: 'store' } } })).toBe('store');
        expect(sourceFrom({ entitlement: { subscription: { source: 'paypal' } } })).toBeNull();
        expect(sourceFrom({ entitlement: { subscription: null } })).toBeNull();
        expect(sourceFrom({})).toBeNull();
    });
});

describe('smartlink', () => {
    test('no page yet gives the empty one', () => {
        expect(parseSmartlink({ smartlink: null, items: [] })).toEqual(EMPTY);
        expect(parseSmartlink(null)).toEqual(EMPTY);
    });
    test('parses the page, items and totals', () => {
        const l = parseSmartlink({ smartlink: { slug: 'a-b', title: 'T', bio: null, avatar_url: 'https://x.test/a.png', theme: 'sunset', published: true }, items: [{ id: 'i1', label: 'L', url: 'https://x.test', enabled: false, clicks: 4 }, { id: 'i2', label: '' }], totals: { views: 10, clicks: 4 } });
        expect(l.theme).toBe('sunset');
        expect(l.items).toEqual([{ id: 'i1', label: 'L', url: 'https://x.test', enabled: false, clicks: 4 }]);
        expect([l.views, l.clicks, l.published]).toEqual([10, 4, true]);
        expect(parseSmartlink({ smartlink: { slug: 'a', theme: 'neon' } }).theme).toBe('midnight');
    });
    test('validation mirrors the route', () => {
        expect(validateSmartlink(link())).toBeNull();
        expect(validateSmartlink(link({ slug: 'Ab' }))).toBe('smartlink.err.slug');
        expect(validateSmartlink(link({ slug: '-ab-' }))).toBe('smartlink.err.slug');
        expect(validateSmartlink(link({ title: ' ' }))).toBe('smartlink.err.title');
        expect(validateSmartlink(link({ bio: 'x'.repeat(281) }))).toBe('smartlink.err.bio');
        expect(validateSmartlink(link({ avatarUrl: 'http://x.test/a.png' }))).toBe('smartlink.err.avatar');
        expect(validateSmartlink(link({ items: [{ id: null, label: 'A', url: 'http://x.test', enabled: true, clicks: 0 }] }))).toBe('smartlink.err.url');
        expect(validateSmartlink(link({ items: [{ id: null, label: '', url: 'https://x.test', enabled: true, clicks: 0 }] }))).toBe('smartlink.err.label');
        expect(validateSmartlink(link({ items: Array.from({ length: 21 }, () => ({ id: null, label: 'A', url: 'https://x.test', enabled: true, clicks: 0 })) }))).toBe('smartlink.err.tooMany');
    });
    test('address typing keeps only allowed characters', () => {
        expect(slugFrom('My Studio_1!')).toBe('mystudio1');
        expect(publicUrl('abc')).toMatch(/\/s\/abc$/);
    });
    test('save sends trimmed fields and leaves out ids of new buttons', async () => {
        const request = jest.fn(async (_p: string, _i?: RequestInit) => ({ smartlink_id: 's1' }));
        await saveSmartlink({ request } as unknown as ApiClient, link({ title: ' Studio ', items: [{ id: 'i1', label: ' A ', url: ' https://x.test ', enabled: true, clicks: 2 }, { id: null, label: 'B', url: 'https://y.test', enabled: false, clicks: 0 }] }));
        expect(request.mock.calls[0][1]?.method).toBe('PUT');
        const body = JSON.parse(String(request.mock.calls[0][1]?.body));
        expect(body.title).toBe('Studio');
        expect(body.items[0]).toEqual({ id: 'i1', label: 'A', url: 'https://x.test', enabled: true });
        expect(body.items[1]).toEqual({ label: 'B', url: 'https://y.test', enabled: false });
    });
    test('error keys', () => {
        expect(smartlinkErrorKey(new ApiError(409, 'slug_taken'))).toBe('smartlink.err.taken');
        expect(smartlinkErrorKey(new ApiError(404, 'smartlinks_not_open'))).toBe('smartlink.err.notOpen');
        expect(smartlinkErrorKey(new ApiError(402, 'plan_required'))).toBe('smartlink.err.plan');
    });
});
