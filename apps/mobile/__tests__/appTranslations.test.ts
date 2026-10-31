import { ACTIVE_LOCALES, APP_CATALOGS, CATALOGS, WEB_CATALOGS, LOCALE_CODES, createTranslator, fill, type LocaleCode } from '../src/lib/i18n';
import { LANGUAGES } from '../src/lib/language';
import en from '../src/lib/i18n/messages/en';
import webKeys from '../src/lib/i18n/webKeys.json';
import { BINDING_ENGLISH_KEYS } from '../src/lib/i18n/binding';

declare const require: (id: string) => any;
const english: Record<string, string> = en;
const binding = new Set<string>(BINDING_ENGLISH_KEYS);
const appKeys = Object.keys(en).filter(key => !webKeys.includes(key));
const slots = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();
const complete = Object.entries(APP_CATALOGS) as [LocaleCode, Record<string, string>][];
// A suffix alone is not a plural family: share.review.one is an ordinary label.
const bases = Object.keys(en).filter(key => key.endsWith('.one') && Object.hasOwn(en, key.slice(0, -4) + '.other')).map(key => key.slice(0, -4));
const pluralBase = (key: string) => {
    const base = key.replace(/\.(zero|one|two|few|many|other)$/, '');
    return base !== key && bases.includes(base) ? base : null;
};
const sourceFor = (key: string) => english[key] ?? english[`${pluralBase(key)}.other`];

test('all eleven languages are enabled in LANGUAGES order with complete app catalogs', () => {
    expect(ACTIVE_LOCALES).toEqual(LANGUAGES.map(language => language.code));
    expect(ACTIVE_LOCALES).toEqual(['en', ...complete.map(([locale]) => locale)]);
});
test('Japanese omits all unused one forms but retains ordinary one labels', () => {
    const unused = Object.keys(APP_CATALOGS.de).filter(key => key.endsWith('.one') && pluralBase(key));
    expect(unused).toHaveLength(66);
    expect(Object.keys(APP_CATALOGS.ja).sort()).toEqual(Object.keys(APP_CATALOGS.de).filter(key => !unused.includes(key)).sort());
    expect(APP_CATALOGS.ja['share.review.one']).toBeDefined();
    expect(new Intl.PluralRules('ja').resolvedOptions().pluralCategories).toEqual(['other']);
});
test.each(complete)('%s covers English app keys, exact slots, equality exceptions and CLDR plurals', (locale, own) => {
    const allowed: Record<string, string> = require(`../src/lib/i18n/review/${locale}-equal.json`);
    const rules = new Intl.PluralRules(locale);
    const categories = rules.resolvedOptions().pluralCategories;
    const required = appKeys.filter(key => !pluralBase(key));
    for (const base of bases.filter(base => appKeys.includes(`${base}.other`))) {
        required.push(...categories.map(category => `${base}.${category}`));
    }
    expect(required.filter(key => !Object.hasOwn(own, key))).toEqual([]);
    expect(Object.keys(own).filter(key => webKeys.includes(key))).toEqual([]);
    expect(Object.keys(own).filter(key => pluralBase(key) && !categories.includes(key.split('.').at(-1) as Intl.LDMLPluralRule))).toEqual([]);
    expect(Object.keys(own).filter(key => !Object.hasOwn(en, key) && !(pluralBase(key) && categories.includes(key.split('.').at(-1) as Intl.LDMLPluralRule)))).toEqual([]);
    for (const [key, value] of Object.entries(own)) {
        const source = sourceFor(key);
        expect({ key, source: typeof source }).toEqual({ key, source: 'string' });
        expect(value.trim()).not.toBe('');
        expect({ key, slots: slots(value) }).toEqual({ key, slots: slots(source) });
        if (binding.has(key)) expect(value).toBe(source);
        else if (value === source) expect({ key, reason: (allowed[key]?.length ?? 0) > 15 }).toEqual({ key, reason: true });
    }
    for (const key of Object.keys(allowed)) {
        expect(binding.has(key)).toBe(false);
        expect(Object.hasOwn(own, key)).toBe(true);
        expect({ key, value: own[key] }).toEqual({ key, value: sourceFor(key) });
    }
    const tr = createTranslator(locale, { [locale]: own }); // no English fallback available
    for (const base of bases) {
        const merged = CATALOGS[locale]!;
        for (const category of categories) {
            expect({ base, category, present: Object.hasOwn(merged, `${base}.${category}`) }).toEqual({ base, category, present: true });
        }
        if (Object.hasOwn(own, `${base}.other`)) {
            const selected = new Set<string>();
            for (const count of [...Array.from({ length: 201 }, (_, i) => i), 0.1, 0.5, 1.5, 1_000_000]) {
                const category = rules.select(count);
                selected.add(category);
                expect(tr.plural(base, count)).toBe(fill(own[`${base}.${category}`], { count }, locale === 'ar'));
            }
            expect([...selected].sort()).toEqual([...categories].sort());
        }
    }
    for (const key of required) expect(tr.t(key)).toBe(own[key]);
    for (const [key, value] of Object.entries(WEB_CATALOGS[locale]!)) expect(CATALOGS[locale]![key]).toBe(value);
});
test.each(LOCALE_CODES)('%s binding keys always remain exact English', locale => {
    const tr = createTranslator(locale, CATALOGS);
    for (const key of BINDING_ENGLISH_KEYS) expect(tr.t(key)).toBe(en[key]);
});
test.each(complete)('%s expanded-copy review includes every string over 1.6x, including added plural forms', (locale) => {
    const rows = Object.entries(CATALOGS[locale]!).filter(([key, value]) => sourceFor(key) && [...value].length > [...sourceFor(key)].length * 1.6)
        .map(([key, value]) => ({ id: key, english: sourceFor(key), translation: value, ratio: Number(([...value].length / [...sourceFor(key)].length).toFixed(2)) }));
    expect(require(`../src/lib/i18n/review/${locale}-length.json`)).toEqual(rows);
});
