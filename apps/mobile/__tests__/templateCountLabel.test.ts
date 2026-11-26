import { CATALOGS } from '../src/lib/i18n';
import { createTranslator } from '../src/lib/i18n/translate';
import type { LocaleCode } from '../src/lib/i18n/locales';
import { templateCountLabel } from '../src/lib/templateCountLabel';

// QA 2.1: Explore Templates header read "150 templates on 1 models".
describe('Explore templates header count line', () => {
    const en = createTranslator('en', CATALOGS);
    it.each([
        [0, '0 templates'],
        [1, '1 template'],
        [73, '73 templates'],
    ])('%i templates -> "%s" (no model count: it never matched what a template runs on)', (templates, text) => {
        expect(templateCountLabel(en, templates)).toBe(text);
    });
    it('keeps runnable templates distinct from CRUN previews', () => {
        expect(templateCountLabel({ ...en, formatNumber: value => value.toLocaleString('en-GB') }, 175, 1088)).toBe('175 ready · 1,088 CRUN previews on web');
    });
    const locales = Object.keys(CATALOGS) as LocaleCode[];
    it.each(locales)('%s fills the count, no placeholder left', (locale) => {
        const tr = createTranslator(locale, CATALOGS);
        for (const t of [0, 1, 2, 5, 21, 150]) {
            const text = templateCountLabel(tr, t);
            expect(text).not.toMatch(/\{\w+\}/);
            expect(text).toContain(String(t));
        }
    });
});
