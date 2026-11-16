import { CATALOGS } from '../src/lib/i18n';
import { createTranslator } from '../src/lib/i18n/translate';
import type { LocaleCode } from '../src/lib/i18n/locales';

// QA 3.28: "From 1 credits". Every price line that names credits goes through the plural mechanism.
const KEYS = ['form.err.priceChanged', 'modelPage.generateLabel', 'prc.each', 'prc.perClip'] as const;
const vars = { title: 'Model', seconds: 5 };
const locales = Object.keys(CATALOGS) as LocaleCode[];

describe('credit prices read right for one and for many', () => {
    const en = createTranslator('en', CATALOGS);
    it.each(KEYS)('%s says "1 credit" and "3 credits" in English', (key) => {
        expect(en.plural(key, 1, vars)).toMatch(/\b1 credit(?!s)/);
        expect(en.plural(key, 3, vars)).toMatch(/\b3 credits/);
    });
    it('the Models list rows already say "from 1 credit"', () => {
        expect(en.plural('create.from', 1)).toBe('from 1 credit');
        expect(en.plural('create.from', 3)).toBe('from 3 credits');
    });
    it.each(locales)('%s fills the count with no placeholder left, for 1, 2, 5 and 21', (locale) => {
        const tr = createTranslator(locale, CATALOGS);
        for (const key of KEYS) for (const n of [1, 2, 5, 21]) {
            const text = tr.plural(key, n, vars);
            expect(text).toContain(String(n));
            expect(text).not.toMatch(/\{\w+\}/);
        }
    });
    it.each(['de', 'es', 'fr', 'pt', 'ru'] as LocaleCode[])('%s has its own singular for the price line', (locale) => {
        const tr = createTranslator(locale, CATALOGS);
        expect(tr.plural('prc.each', 1)).not.toBe(tr.plural('prc.each', 1).replace('1', '3'));
        expect(tr.plural('prc.each', 1).replace('1', '#')).not.toBe(tr.plural('prc.each', 3).replace('3', '#'));
    });
});

describe('Create copy that fits the kind of tool', () => {
    it('the add-sound tool has a sound hint, not "Describe the change"', () => {
        expect(CATALOGS.en!['form.describeSoundPass']).toBe('Describe the sound you want (optional)');
        expect(CATALOGS.en!['form.describeChange']).toBe('Describe the change (optional)');
    });
    it('the attach button in Chat is not named like the output mode (QA 5.4c)', () => {
        expect(CATALOGS.en!['chatDepth.video']).toBe('Attach a video');
        expect(CATALOGS.en!['chat.make.kind.video']).toBe('Video');
        for (const locale of locales) expect(CATALOGS[locale]!['chatDepth.video']).not.toBe(CATALOGS[locale]!['chat.make.kind.video']);
    });
});
