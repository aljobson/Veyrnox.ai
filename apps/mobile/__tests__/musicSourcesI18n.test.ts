import musicSourcesByLocale from '../src/lib/i18n/messages/musicSources';
import { ACTIVE_LOCALES } from '../src/lib/i18n';

const slots = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();
test('owned audio ships complete copy with matching placeholders in all eleven locales', () => {
    expect(Object.keys(musicSourcesByLocale).sort()).toEqual([...ACTIVE_LOCALES].sort());
    const english = musicSourcesByLocale.en;
    for (const catalog of Object.values(musicSourcesByLocale)) {
        expect(Object.keys(catalog).sort()).toEqual(Object.keys(english).sort());
        for (const [key, source] of Object.entries(english)) {
            expect((catalog as Record<string, string>)[key].trim()).not.toBe('');
            expect(slots((catalog as Record<string, string>)[key])).toEqual(slots(source));
        }
    }
});
