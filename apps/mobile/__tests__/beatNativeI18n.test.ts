import { APP_CATALOGS } from '../src/lib/i18n';
import beat from '../src/lib/i18n/messages/en/beat';

const slots = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();
test.each(Object.entries(APP_CATALOGS))('%s contains every English beat key without fallback and preserves placeholders', (_locale, own) => {
    const catalog: Record<string, string> = own;
    for (const [key, value] of Object.entries(beat)) {
        expect(Object.hasOwn(catalog, key)).toBe(true);
        expect(catalog[key]?.trim()).toBeTruthy();
        expect(slots(catalog[key])).toEqual(slots(value));
    }
});
