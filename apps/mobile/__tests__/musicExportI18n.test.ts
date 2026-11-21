import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import messages from '../src/lib/i18n/messages/en/musicExport';
import en from '../src/lib/i18n/messages/en';
import { CATALOGS, createTranslator } from '../src/lib/i18n';
import { exportMessage } from '../src/lib/music/exportMessages';
const slots = (v: string) => [...v.matchAll(/\{([^}]+)\}/g)].map(m => m[1]).sort();
test('registered English export copy has no credit or saved-success wording', () => {
    for (const [key, value] of Object.entries(messages)) {
        expect(key).toMatch(/^musicExport\./); expect(en[key as keyof typeof en]).toBe(value);
        expect(value).not.toMatch(/credits?|balance|spend|saved|success/i);
    }
});
test.each(['ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh'] as const)('%s has translations, slots, review and plural copy', locale => {
    const catalog = CATALOGS[locale] as Record<string, string>;
    const review = JSON.parse(readFileSync(resolve(__dirname, `../src/lib/i18n/review/${locale}-equal.json`), 'utf8'));
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    for (const [key, value] of Object.entries(messages)) {
        if (key === 'musicExport.remaining.one' && !categories.includes('one')) continue;
        expect(catalog[key]?.trim()).toBeTruthy(); expect(slots(catalog[key])).toEqual(slots(value));
        if (catalog[key] === value) expect(review[key]).toEqual(expect.any(String));
    }
    const tr = createTranslator(locale, CATALOGS);
    for (const count of [0, 1, 2, 3, 11]) expect(tr.plural('musicExport.remaining', count)).not.toMatch(/musicExport|\{count\}/);
});
test('English singular and plural remaining-download copy', () => {
    const tr = createTranslator('en', CATALOGS); expect(tr.plural('musicExport.remaining', 1)).toBe('1 download remaining.');
    expect(tr.plural('musicExport.remaining', 4)).toBe('4 downloads remaining.');
});
test.each(['download_allowance_exhausted', 'render_required', 'format_unavailable', 'quote_expired', 'network', 'not_found', 'unknown'])('%s has no raw codes or credit copy', code => {
    expect(exportMessage(code)).not.toContain(code); expect(exportMessage(code)).not.toMatch(/credits|balance|purchase|musicExport/);
});
