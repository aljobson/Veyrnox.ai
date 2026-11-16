import { CATALOGS } from '../src/lib/i18n';
import { createTranslator } from '../src/lib/i18n/translate';
import type { LocaleCode } from '../src/lib/i18n/locales';
import { templateCountLabel } from '../src/lib/templateCountLabel';

// QA 2.1: Explore Templates header read "150 templates on 1 models".
describe('Explore templates header count line', () => {
    const en = createTranslator('en', CATALOGS);
    it.each([
        [0, 0, '0 templates'],
        [1, 1, '1 template on 1 model'],
        [150, 1, '150 templates on 1 model'],
        [1, 3, '1 template on 3 models'],
        [150, 12, '150 templates on 12 models'],
    ])('%i templates, %i models -> "%s"', (templates, models, text) => {
        expect(templateCountLabel(en, templates, models)).toBe(text);
    });
    const locales = Object.keys(CATALOGS) as LocaleCode[];
    it.each(locales)('%s fills both counts, no placeholder left', (locale) => {
        const tr = createTranslator(locale, CATALOGS);
        for (const [t, m] of [[0, 0], [1, 1], [2, 2], [5, 1], [21, 21], [150, 12]]) {
            const text = templateCountLabel(tr, t!, m!);
            expect(text).not.toMatch(/\{\w+\}/);
            expect(text).toContain(String(t));
            if (t) expect(text).toContain(String(m));
        }
    });
});
