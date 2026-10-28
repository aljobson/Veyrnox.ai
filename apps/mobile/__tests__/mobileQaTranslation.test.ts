import { editorTrackLabel } from '../src/lib/editorTrackLabel';
import { ACTIVE_LOCALES, CATALOGS, chooseLocale, formatCurrency, formatNumber, plural, rawText, t, tAccessibility } from '../src/lib/i18n';
import { numberText, resetNumberFormatCache, supportsNumberLocale } from '../src/lib/i18n/numbers';
import { captionWarning, createBody, validateDraft, type Draft } from '../src/lib/publishCompose';
import { attachMessage, attachReferral, friendsLine } from '../src/lib/referrals';
import { versionLabel } from '../src/lib/projects';
import { planName } from '../src/lib/creditOffers';
import { categoryLabel } from '../src/lib/presetCategoryLabel';
import { dollars } from '../src/lib/topUps';
import { money as adMoney } from '../src/lib/publishAds';
import { money as commerceMoney } from '../src/lib/publishCommerce';
import { percentText } from '../src/lib/publishAnalytics';
import { ApiError } from '../src/lib/api';
import { createTranslator } from '../src/lib/i18n/translate';
import type { LocaleCode } from '../src/lib/i18n/locales';

jest.mock('expo-secure-store', () => ({ getItem: () => null }));
afterEach(() => { chooseLocale('en'); jest.restoreAllMocks(); resetNumberFormatCache(); });
const draft: Draft = { jobId: 'job', mediaType: 'image', accountIds: ['account'], text: 'caption', when: { kind: 'now' } };

test.each(ACTIVE_LOCALES)('%s translates compose errors, referrals, versions, kinds, plans and categories', locale => {
    chooseLocale(locale);
    expect(captionWarning('x'.repeat(281), ['twitter'])).toBe(t('publishCompose.captionLimit', { name: 'X', limit: 280, length: 281 }));
    expect(validateDraft(draft, [], new Date())).toBe(t('publishCompose.unsupportedMedia', { name: t('publishCompose.account'), kind: t('mediaKind.image') }));
    expect(attachMessage(new ApiError(400, 'already_attached'))).toBe(t('referrals.alreadyAttached'));
    expect(friendsLine(2)).toBe(plural('referrals.friends', 2));
    expect(versionLabel({ revision: 3, restoredFrom: 1, createdAt: null })).toBe(t('projects.restoredVersion', { version: 3, source: 1 }));
    for (const id of ['lite', 'starter', 'plus', 'ultra']) expect(planName(id)).toBe(t(`credits.plan.${id}`));
    expect(planName('private-internal-plan')).toBe(t('credits.plan.unknown'));
    expect(planName('')).toBe(t('credits.plan.unknown'));
    expect(categoryLabel('PRODUCTS')).toBe(t('presets.cat.PRODUCTS'));
    expect(categoryLabel('internal-category')).toBe(t('explore.categories'));
    expect(editorTrackLabel({ id: 'audio-0', kind: 'audio', name: 'Audio 1' })).toBe(`${t('editor.track.audio')} ${formatNumber(1)}`);
    expect(editorTrackLabel({ id: 'audio-0', kind: 'audio', name: 'My soundtrack' })).toBe('My soundtrack');
    for (const kind of ['image', 'video', 'audio', 'text']) expect(CATALOGS[locale]![`mediaKind.${kind}`]).toBeTruthy();
    for (const source of ['photo', 'video', 'reference', 'prompt']) {
        const key = `start.continue.${source}`;
        expect(CATALOGS[locale]![key]).toBeTruthy();
        expect(t(key)).not.toMatch(/\{|start\.continue/);
        if (locale !== 'en') expect(t(key)).not.toBe(CATALOGS.en![key]);
    }
});

test.each<LocaleCode>(['de', 'fr', 'ar'])('%s formats currency and decimals consistently', locale => {
    chooseLocale(locale);
    const price = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(1234.5);
    expect(dollars(123450)).toBe(price);
    expect(adMoney(123450, 'USD')).toBe(price);
    expect(commerceMoney(123450, 'USD')).toBe(price);
    expect(formatNumber(1234.5, 1)).toBe(new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(1234.5));
    const progress = t('cinemaUpload.progress', { percent: 25, sent: formatNumber(1.5, 1), total: formatNumber(6, 1) });
    if (locale === 'ar') expect(/[0-9]/.test(progress) && /[٠-٩]/.test(progress)).toBe(false);
    expect(percentText({ change: 1234, percent: 1.5 })).toContain(formatNumber(1.5, 1));
});

test('all eleven locales are probed, and missing Intl data still formats without throwing', () => {
    for (const locale of ACTIVE_LOCALES) expect(supportsNumberLocale(locale)).toBe(true);
    jest.spyOn(Intl.NumberFormat, 'supportedLocalesOf').mockReturnValue([]);
    resetNumberFormatCache();
    for (const locale of ACTIVE_LOCALES) expect(numberText(locale, 1234.5, 1)).toBeTruthy();
    expect(numberText('ar', 1234.5, 1)).toBe('١٬٢٣٤٫٥');
    chooseLocale('de'); expect(formatCurrency(12.5, 'USD')).toBe('12,50 USD');
    chooseLocale('ar'); expect(formatCurrency(12.5, 'USD')).toBe('١٢٫٥٠ USD');
});

test('English groups thousands; invalid currencies keep localized decimals', () => {
    expect(formatNumber(12345)).toBe('12,345');
    chooseLocale('fr'); expect(formatCurrency(12.5, 'invalid')).toBe('12,50 invalid');
});

test('Arabic isolates display variables, accessibility uses raw values, and wire payloads are untouched', async () => {
    const vars = { name: 'A @name <name@example.com> https://example.com' };
    const catalogs = { en: { sample: '{name}' }, ar: { sample: '{name}' } };
    expect(createTranslator('ar', catalogs).t('sample', vars)).toBe(`\u2068${vars.name}\u2069`);
    expect(createTranslator('en', catalogs).t('sample', vars)).toBe(vars.name);
    chooseLocale('ar');
    expect(t('account.contact', { email: 'a@example.com' })).toContain('\u2068a@example.com\u2069');
    expect(tAccessibility('account.contact', { email: 'a@example.com' })).not.toMatch(/[\u2068\u2069]/);
    expect(rawText(t('account.contact', { email: 'a@example.com' }))).toContain('a@example.com');
    expect(createBody(draft, 'key', new Date())).toMatchObject({ globalText: 'caption', accountIds: ['account'], idempotencyKey: 'key' });
    const request = jest.fn().mockResolvedValue({});
    await attachReferral({ request } as never, 'ABCDEF2345');
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ code: 'ABCDEF2345' });
    expect(vars.name).toBe('A @name <name@example.com> https://example.com');
});

test('correct terminology and Arabic credit plural families', () => {
    expect(CATALOGS.de!['tabs.editor']).toBe('Editor');
    expect(CATALOGS.ko!['tabs.editor']).toBe('편집기');
    for (const locale of ['ar', 'zh', 'ja', 'ko', 'hi', 'ru'] as const) expect(CATALOGS[locale]!['label.Credits']).not.toBe('Credits');
    for (const base of ['home.credits', 'credits.pack']) for (const form of ['zero', 'one', 'two', 'few', 'many', 'other']) expect(CATALOGS.ar![`${base}.${form}`]).toBe('{count} كريدت');
    for (const key of ['explore.heroAction', 'explore.chatAction']) expect(CATALOGS.ar![key]).toMatch(/←$/);
    for (const [key, value] of Object.entries(CATALOGS.de!)) if (/^(studioSkills|filmSkills)\./.test(key)) expect(value).not.toMatch(/\bSie\b|\bIhr\b/);
    expect(CATALOGS.de!['app.create.error.idempotency_conflict']).toContain('Prüfe');
});

test.each(ACTIVE_LOCALES.filter(c => c !== 'en'))('%s guide buttons match the rendered controls', locale => {
    const c = CATALOGS[locale]!;
    if (locale === 'hi' || locale === 'ko') expect(c['helpGuides.content.first-generation.s1.body']).toContain(c['oauth.signIn']);
    // These bodies must name the actual buttons, including already translated locales.
    for (const [guide, button] of [
        ['templates.s3', 'libraryCreate.useTemplate'], ['templates.s3', 'slip.generate'],
        ['your-own-files.s3', 'libsrc.choose'],
    ]) expect(c[`helpGuides.content.${guide}.body`]).toContain(c[button]);
    for (const [key, body] of Object.entries(c)) if (key.startsWith('helpGuides.content.') && key.endsWith('.body')) expect(body).not.toMatch(/Use this template|Generate|From library|Sign in/);
});
