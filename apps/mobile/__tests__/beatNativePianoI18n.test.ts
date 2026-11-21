import { APP_CATALOGS } from '../src/lib/i18n';
import beatPiano from '../src/lib/i18n/messages/en/beatPiano';
const slots = (v: string) => (v.match(/\{\w+\}/g) ?? []).sort();
test.each(Object.entries(APP_CATALOGS))('%s has every beatPiano key and its placeholders without fallback', (_locale, catalog) => {
    for (const [key, value] of Object.entries(beatPiano)) {
        expect(key.startsWith('beatPiano.')).toBe(true);
        expect(Object.hasOwn(catalog, key)).toBe(true);
        expect(catalog[key]?.trim()).toBeTruthy(); expect(slots(catalog[key])).toEqual(slots(value));
    }
});


test.each([['en', beatPiano], ...Object.entries(APP_CATALOGS)])('%s distinguishes keyboard and selected-note controls', (_locale, own) => {
    const catalog = own as Record<string, string>;
    for (const [selected, keyboard] of [
        ['beatPiano.selected.octaveDown', 'beatPiano.keys.octaveDown'],
        ['beatPiano.selected.octaveUp', 'beatPiano.keys.octaveUp'],
        ['beatPiano.velocityDown', 'beatPiano.keys.velocityDown'],
        ['beatPiano.velocityUp', 'beatPiano.keys.velocityUp'],
    ]) expect(catalog[selected]).not.toBe(catalog[keyboard]);
});
test('French and Spanish cursor controls describe earlier and later time positions', () => {
    expect(APP_CATALOGS.fr['beatPiano.cursorLeft']).toBe('Curseur plus tôt');
    expect(APP_CATALOGS.fr['beatPiano.cursorRight']).toBe('Curseur plus tard');
    expect(APP_CATALOGS.es['beatPiano.cursorLeft']).toBe('Cursor antes');
    expect(APP_CATALOGS.es['beatPiano.cursorRight']).toBe('Cursor después');
});
