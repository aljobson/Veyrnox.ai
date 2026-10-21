import { API_BASE, ApiError } from '../src/lib/api';
import { mapAppLink } from '../src/lib/appLinks';
import { acceptInvite, inviteErrorKey, inviteState, inviteTokenFromLink, parseInvite } from '../src/lib/shareLinks';
import app from '../app.json';

const TOKEN = 'a.b';
const link = (host: string) => `${host}/social/team/invite/${TOKEN}`;

test('paste accepts production, www and the API origin after trimming', () => {
    for (const host of ['https://veyrnox.ai', 'https://www.veyrnox.ai', API_BASE]) {
        expect(inviteTokenFromLink(`  ${link(host)}  `)).toBe(TOKEN);
    }
});

test('paste accepts a staging API origin', () => {
    jest.isolateModules(() => {
        jest.doMock('../src/lib/api', () => ({ ...jest.requireActual('../src/lib/api'), API_BASE: 'https://staging.example.test' }));
        const staging = require('../src/lib/shareLinks') as typeof import('../src/lib/shareLinks');
        expect(staging.inviteTokenFromLink(link('https://staging.example.test'))).toBe(TOKEN);
        expect(staging.inviteTokenFromLink(link('https://another.example.test'))).toBeNull();
    });
    jest.dontMock('../src/lib/api');
});

test.each([
    link('http://veyrnox.ai'), link('https://other.test'), link('https://veyrnox.ai.evil.test'),
    link('https://user:pw@veyrnox.ai'), link('https://evil@veyrnox.ai'), link('https://veyrnox.ai:8443'),
    'https://veyrnox.ai/social/review/a.b', `${link('https://veyrnox.ai')}/extra`, `${link('https://veyrnox.ai')}/`,
    TOKEN, '/team-invite?token=a.b', 'ai.veyrnox.app://team-invite?token=a.b',
    `${link('https://veyrnox.ai')}?${'x'.repeat(2100)}`, link('https://veyrnox.ai').replace('a.b', 'bad'), null, 4,
])('paste rejects unsupported input %#', (input) => {
    expect(inviteTokenFromLink(input)).toBeNull();
});

test.each([
    [400, 'INVITE_UNAVAILABLE', 'publishLinks.teamJoin.err.unavailable'],
    [429, 'rate', 'publishLinks.teamJoin.err.rate'],
    [503, 'teams_not_configured', 'share.invite.err.off'],
    [404, 'not_found', 'share.invite.err.off'],
])('invite outcome %s %s is readable', (status, code, key) => {
    expect(inviteErrorKey(new ApiError(status as number, code))).toBe(key);
});

test.each([
    ['pending', '2026-10-20T12:00:00Z', 'expired'], ['pending', '2026-10-19T12:00:00Z', 'expired'],
    ['expired', null, 'expired'], ['accepted', '2020-01-01', 'accepted'], ['revoked', '2020-01-01', 'revoked'],
    ['pending', '2027-01-01', 'open'], ['', null, 'open'], ['pending', 'invalid', 'open'], ['other', '2020-01-01', 'closed'],
])('invitation state %s with expiry %s', (status, expires_at, expected) => {
    expect(inviteState(parseInvite({ status, expires_at }), new Date('2026-10-20T12:00:00Z'))).toBe(expected);
});

test('repeat acceptance preserves the server idempotent result', async () => {
    const request = jest.fn().mockResolvedValue({ ok: true, brand_id: 'brand', role: 'editor', idempotent: true });
    expect(await acceptInvite({ request }, TOKEN)).toEqual({ brandId: 'brand', role: 'editor', idempotent: true });
});

test('native Android prefix and existing application mapping cover team invitations', () => {
    expect(app.expo.android.intentFilters.flatMap((filter) => filter.data)).toContainEqual({ scheme: 'https', host: 'veyrnox.ai', pathPrefix: '/social/team/invite/' });
    expect(mapAppLink(link('https://veyrnox.ai'))).toBe('/team-invite?token=a.b');
});
