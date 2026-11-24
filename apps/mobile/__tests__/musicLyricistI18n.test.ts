import { CATALOGS, LOCALE_CODES } from '../src/lib/i18n';
import en from '../src/lib/i18n/messages/en/musicLyricist';
import translations from '../src/lib/i18n/messages/musicLyricist';

const slots = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test.each(LOCALE_CODES)('private Lyricist copy is complete in %s', locale => {
    const catalog = CATALOGS[locale]!;
    for (const [key, english] of Object.entries(en)) {
        expect(catalog[key]?.trim()).toBeTruthy();
        expect(slots(catalog[key]!)).toEqual(slots(english));
        if (locale !== 'en') expect(catalog[key]).toBe((translations as Record<string, Record<string, string>>)[locale]![key]);
    }
});
