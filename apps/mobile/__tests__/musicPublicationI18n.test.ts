import messages from '../src/lib/i18n/messages/en/musicPublication';
import en from '../src/lib/i18n/messages/en';
import { APP_CATALOGS, ACTIVE_LOCALES } from '../src/lib/i18n';
const slots = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();
test('P4c keys and placeholders are present in all eleven locales without fallback', () => {
    expect(ACTIVE_LOCALES).toHaveLength(11);
    const keys = Object.keys(messages).sort();
    for (const catalog of [en, ...Object.values(APP_CATALOGS)]) {
        const values = catalog as Record<string, string>;
        expect(Object.keys(values).filter(key => key.startsWith('musicPublication.')).sort()).toEqual(keys);
        for (const [key, source] of Object.entries(messages)) {
            expect(values[key].trim()).not.toBe(''); expect(slots(values[key])).toEqual(slots(source));
        }
    }
    // P4c introduces no plural family; the full appTranslations suite checks existing CLDR families.
    expect(keys.filter(key => /\.(zero|one|two|few|many|other)$/.test(key))).toEqual([]);
});
