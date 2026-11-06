import { httpsAddress } from '../src/lib/httpsAddress';
import { buildProductBody, emptyProductForm } from '../src/lib/publishCommerce';
import { buildCampaignBody, emptyForm as emptyCampaign } from '../src/lib/publishAds';
import { SLUG_RE, validateSmartlink, EMPTY as EMPTY_LINK, type SmartLink } from '../src/lib/publishSmartlink';
import { buildReportBody, emptyReportForm } from '../src/lib/publishReports';
import { validateAutolist, type AutolistInput } from '../src/lib/publishAutolists';
import { validEmail } from '../src/lib/publishTeam';
import { normalizeReferralCode } from '../src/lib/referrals';
import { inviteTokenFromLink } from '../src/lib/shareLinks';
import { validNonce } from '../src/lib/accountSecurity';

// Hostile and malformed text a person can type or paste. None may reach a network call: each builder or validator
// answers with a catalogue key (an inline message) instead.
const BIDI = String.fromCharCode(0x202e);
const INVISIBLE_ADDRESS_CHARS = [0x00ad, 0x034f, 0x115f, 0x1160, 0x180e, 0x2800, 0x3164, 0xfe0f, 0xffa0].map(code => String.fromCharCode(code));
const DOT_LOOKALIKES = [0x2024, 0x3002, 0xfe52, 0xff0e, 0xff61].map(code => String.fromCharCode(code));
const BAD_ADDRESSES = ['http://', 'http://example.com', 'javascript:alert(1)', 'https://', 'https://?', 'https://.', 'https://exa mple.com',
    'https://user:pw@example.com', `https://example.com${BIDI}`, `https://exa${BIDI}mple.com`, 'https://localhost', 'https://-a.com', '🙂', `https://${'a'.repeat(64)}.com`,
    `https://example.com/${'a'.repeat(3000)}`, 'https://example.com/' + String.fromCharCode(0x200b) + 'hidden', 'ftp://example.com', 'example.com', 'https:example.com',
    'HTTPS://example.com', 'Https://example.com', 'https://🙂.com', 'https://example.com:0', 'https://example.com:65536', 'https://example.com:99999',
    ...INVISIBLE_ADDRESS_CHARS.map(char => `https://exa${char}mple.com`), ...DOT_LOOKALIKES.map(char => `https://example${char}com`)];
const GOOD_ADDRESSES = ['https://example.com', 'https://example.com/a?b=c#d', 'https://sub.example.co.uk:8443/path', 'https://bücher.de/x'];
const BAD_MONEY = ['', '   ', '-5', '-0.01', '1e9', '1e2', '0.001', '12.345', 'abc', 'NaN', 'Infinity', '١٢', '🙂', '1'.repeat(40), '1,000.00', '12 50', '0x10', '+5'];

describe('httpsAddress', () => {
    test.each(BAD_ADDRESSES)('rejects %j', value => expect(httpsAddress(value)).toBeNull());
    test.each(GOOD_ADDRESSES)('accepts %j', value => expect(httpsAddress(value)).toBe(value));
    test('trims whitespace and is not fooled by non-strings', () => {
        expect(httpsAddress('  https://example.com  ')).toBe('https://example.com');
        expect(httpsAddress('   ')).toBeNull();
        expect(httpsAddress(undefined)).toBeNull();
        expect(httpsAddress(42)).toBeNull();
    });
    test('honours the caller length limit', () => expect(httpsAddress(`https://example.com/${'a'.repeat(100)}`, 50)).toBeNull());
});

describe('Commerce product (Price, Currency, links)', () => {
    const form = (over: object) => ({ ...emptyProductForm(), title: 'Mug', price: '10', ...over });
    test.each(BAD_MONEY)('price %j is refused with the price message', price => expect(buildProductBody(form({ price }))).toEqual({ errorKey: 'commerce.err.price' }));
    test.each(['0', '25', ' 24.99 ', '24,99'])('price %j is accepted', price => expect('body' in buildProductBody(form({ price }))).toBe(true));
    test('price is trimmed and sent in cents', () => expect((buildProductBody(form({ price: ' 24.99 ' })) as any).body.priceCents).toBe(2499));
    test.each(['', '  ', 'GB', 'GBPP', '£££', '12$', 'G B', '🙂🙂🙂', 'javascript:alert(1)'])('currency %j is refused', currency =>
        expect(buildProductBody(form({ currency }))).toEqual({ errorKey: 'commerce.err.currency' }));
    test('currency is trimmed and upper-cased', () => expect((buildProductBody(form({ currency: ' gbp ' })) as any).body.currency).toBe('GBP'));
    test.each(BAD_ADDRESSES)('product link and picture %j are refused', value => {
        expect(buildProductBody(form({ productUrl: value }))).toEqual({ errorKey: 'commerce.err.url' });
        expect(buildProductBody(form({ imageUrl: value }))).toEqual({ errorKey: 'commerce.err.url' });
    });
    test.each(['', '   '])('an empty link %j is left out, not refused', value => expect((buildProductBody(form({ productUrl: value })) as any).body.productUrl).toBeNull());
});

describe('Ads campaign (Daily budget, Currency, links, ages)', () => {
    const form = (over: object) => ({ ...emptyCampaign(), name: 'Spring', ...over });
    test.each([...BAD_MONEY, '0.99', '0', '100000000'])('daily budget %j is refused with the budget message', dailyBudget =>
        expect(buildCampaignBody(form({ dailyBudget }))).toEqual({ errorKey: 'ads.err.budget' }));
    test.each(['1', '15', ' 12,50 ', '999999.99'])('daily budget %j is accepted', dailyBudget => expect('body' in buildCampaignBody(form({ dailyBudget })).valueOf()).toBe(true));
    test.each(['', 'GB', 'GBPP', '£££', 'G B', '🙂🙂🙂'])('currency %j is refused', currency => expect(buildCampaignBody(form({ currency }))).toEqual({ errorKey: 'ads.err.currency' }));
    test.each(BAD_ADDRESSES)('destination and lead-form links %j are refused', value => {
        expect(buildCampaignBody(form({ destinationUrl: value }))).toEqual({ errorKey: 'ads.err.url' });
        expect(buildCampaignBody(form({ leadFormUrl: value }))).toEqual({ errorKey: 'ads.err.url' });
    });
    test.each([['', '65'], ['18', ''], ['0x1F', '65'], ['18', '1e2'], ['18.5', '65'], ['-18', '65'], ['12', '65'], ['18', '101'], ['40', '30'], ['abc', '65']])('ages %j/%j are refused', (ageMin, ageMax) =>
        expect(buildCampaignBody(form({ ageMin, ageMax }))).toEqual({ errorKey: 'ads.err.age' }));
});

describe('Smartlink (address slug, picture address)', () => {
    const link = (over: Partial<SmartLink>): SmartLink => ({ ...EMPTY_LINK, slug: 'my-page', title: 'Hello', ...over });
    test.each(['', '   ', 'ab', '-abc', 'abc-', 'A B C', 'ab cd', 'a'.repeat(49), '🙂🙂🙂', 'javascript:alert(1)', '../etc', 'ab/cd', 'ABC', `abc${BIDI}`])('slug %j is refused', slug =>
        expect(validateSmartlink(link({ slug }))).toBe('smartlink.err.slug'));
    test.each(['abc', 'my-page', 'a1-b2-c3', 'a'.repeat(48)])('slug %j is accepted', slug => expect(validateSmartlink(link({ slug }))).toBeNull());
    test('slug is trimmed before the pattern is applied', () => expect(validateSmartlink(link({ slug: '  my-page  ' }))).toBeNull());
    test('slug pattern matches the server', () => expect(SLUG_RE.source).toBe('^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$'));
    test.each(BAD_ADDRESSES)('picture address %j is refused', avatarUrl => expect(validateSmartlink(link({ avatarUrl }))).toBe('smartlink.err.avatar'));
    test.each(BAD_ADDRESSES)('button link %j is refused', url => expect(validateSmartlink(link({ items: [{ id: null, label: 'Shop', url, enabled: true, clicks: 0 }] }))).toBe('smartlink.err.url'));
    test('an empty picture address is allowed', () => expect(validateSmartlink(link({ avatarUrl: '  ' }))).toBeNull());
});

describe('Report (Accent colour hex, Recipients)', () => {
    const form = (over: object) => ({ ...emptyReportForm(), name: 'Weekly', ...over });
    test.each(['', '   ', 'red', '38bdf8', '#38bdf', '#38bdf80', '#gggggg', '#38bd f8', '#３８bdf8', 'javascript:alert(1)', `#38bdf8${BIDI}`, '#🙂🙂🙂'])('accent %j is refused with the colour message', accentColor =>
        expect(buildReportBody(form({ accentColor })).errorKey).toBe('publishReporting.err.accent'));
    test('accent is trimmed and lower-cased', () => expect(buildReportBody(form({ accentColor: '  #38BDF8 ' })).body?.accentColor).toBe('#38bdf8'));
    test.each(['not-an-email', 'a@b', '@b.com', 'a@@b.com', 'a b@c.com', '<script>@x.com', 'ok@example.com, not-an-email', 'x'.repeat(300) + '@example.com'])('recipients %j are refused with the recipients message', deliveryRecipients =>
        expect(buildReportBody(form({ deliveryRecipients, deliveryCadence: 'weekly' })).errorKey).toBe('publishReporting.err.recipients'));
    test('a scheduled report needs a recipient', () => expect(buildReportBody(form({ deliveryRecipients: '   ', deliveryCadence: 'weekly' })).errorKey).toBe('publishReporting.err.recipients'));
    test('more than ten recipients are refused', () =>
        expect(buildReportBody(form({ deliveryRecipients: Array.from({ length: 11 }, (_, i) => `p${i}@example.com`).join(',') })).errorKey).toBe('publishReporting.err.recipients'));
    test('a bad reply-to is refused with the recipients message', () => expect(buildReportBody(form({ deliveryReplyTo: 'nope' })).errorKey).toBe('publishReporting.err.recipients'));
    test('recipients are split on spaces, commas and semicolons, trimmed, lower-cased and de-duplicated', () =>
        expect(buildReportBody(form({ deliveryRecipients: '  A@Example.com; b@example.com,\n a@example.com ', deliveryCadence: 'weekly' })).body?.deliveryRecipients).toEqual(['a@example.com', 'b@example.com']));
});

describe('Autolist feed address', () => {
    const input = (feedUrl: string): AutolistInput => ({ id: null, queueId: 'q', name: 'Feed', feedUrl, captionTemplate: '{{title}} {{link}}', refreshIntervalMinutes: 60, enabled: true, autoSchedule: false });
    test.each(['', '   ', ...BAD_ADDRESSES])('feed %j is refused', value => expect(validateAutolist(input(value))).toBe('autolists.err.feed'));
    test.each(GOOD_ADDRESSES)('feed %j is accepted', value => expect(validateAutolist(input(value))).toBeNull());
});

describe('Team invite email, referral code, invitation link, emailed code', () => {
    test.each(['', '   ', 'not-an-email', 'a@b', '@b.com', 'a b@c.com', 'a@@b.com', '<x>@y.com', `${'a'.repeat(65)}@example.com`, '🙂@🙂.🙂 ', 'javascript:alert(1)'])('email %j is invalid', value => expect(validEmail(value)).toBe(false));
    test('a normal email is valid', () => expect(validEmail('friend@example.com')).toBe(true));
    test.each(['', '   ', 'ABC', 'ABCDEFGHJ', 'ABCDEFGHJKM', 'ABCD EFGH JK', 'ABCDE-FGHJK', 'ILOO000111', '1234567890', '🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂', 'A'.repeat(40), '<script>', `ABCDEFGHJK${BIDI}`])('referral code %j is refused', value =>
        expect(normalizeReferralCode(value)).toBeNull());
    test('a referral code is trimmed and upper-cased', () => expect(normalizeReferralCode('  abcdefghjk ')).toBe('ABCDEFGHJK'));
    test.each(['', '   ', 'not a link', 'javascript:alert(1)', 'http://veyrnox.ai/social/team/invite/aaa.bbb', 'https://evil.example/social/team/invite/aaa.bbb', 'https://veyrnox.ai.evil.com/social/team/invite/aaa.bbb',
        'https://user:pw@veyrnox.ai/social/team/invite/aaa.bbb', 'https://veyrnox.ai:8443/social/team/invite/aaa.bbb', 'https://veyrnox.ai/social/team/invite/', 'https://veyrnox.ai/social/team/invite/a b.c',
        `https://veyrnox.ai/social/team/invite/aaa.bbb${BIDI}`, 'https://veyrnox.ai/social/team/invite/aaa', `https://veyrnox.ai/social/team/invite/${'a'.repeat(3000)}.b`])('invitation link %j is refused', value =>
        expect(inviteTokenFromLink(value)).toBeNull());
    test('a real invitation link, with spaces around it, gives its token', () => expect(inviteTokenFromLink('  https://veyrnox.ai/social/team/invite/aaa.bbb  ')).toBe('aaa.bbb'));
    test.each(['', '   ', '12345', '123 456', '12345678901', 'abcdef', '１２３４５６', '12-34-56', '🙂🙂🙂🙂🙂🙂', '<script>'])('emailed code %j is refused', value => expect(validNonce(value)).toBe(false));
});
