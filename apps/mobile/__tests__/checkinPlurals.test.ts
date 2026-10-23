import { CATALOGS, createTranslator } from '../src/lib/i18n';
import type { LocaleCode } from '../src/lib/i18n/locales';

test('Russian check-in amounts and earned copy use the correct plural category', () => {
    const ru = createTranslator('ru', CATALOGS);
    const counts = [1, 2, 3, 4, 5, 11, 21, 22];
    const endings = ['кредит', 'кредита', 'кредита', 'кредита', 'кредитов', 'кредитов', 'кредит', 'кредита'];
    counts.forEach((credits, i) => {
        expect(ru.plural('checkin.credits', credits, { credits })).toBe(`${credits} ${endings[i]}`);
        expect(ru.plural('checkin.earned', credits, { credits })).toBe(`Вы получили ${credits} ${endings[i]}.`);
    });
});
test('every mobile catalog supplies each reward plural without English fallback', () => {
    for (const locale of Object.keys(CATALOGS) as LocaleCode[]) {
        const translator = createTranslator(locale, CATALOGS);
        for (const credits of [1, 2, 3]) for (const base of ['checkin.credits', 'checkin.earned']) {
            const category = new Intl.PluralRules(locale).select(credits);
            expect(typeof CATALOGS[locale]?.[`${base}.${category}`]).toBe('string');
            expect(translator.plural(base, credits, { credits })).not.toMatch(/checkin\.|\{credits\}/);
        }
    }
    expect(createTranslator('ar', CATALOGS).plural('checkin.credits', 2, { credits: 2 })).toBe('2 من الرصيد');
    expect(createTranslator('hi', CATALOGS).plural('checkin.earned', 2, { credits: 2 })).toBe('आपने 2 क्रेडिट कमाए।');
});
