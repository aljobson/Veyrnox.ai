import en from '../src/lib/i18n/messages/en/music';
import { ACTIVE_LOCALES, APP_CATALOGS } from '../src/lib/i18n';

const keys = [
    'music.create.inspiration.title', 'music.create.inspiration.body', 'music.create.inspiration.rights',
    'music.create.inspiration.choose', 'music.create.inspiration.chooseImage', 'music.create.inspiration.imageLimit',
    'music.create.inspiration.imageType', 'music.create.inspiration.notAllowed', 'music.create.inspiration.dailyLimit',
] as const;

test('every active app locale has the complete media-inspiration copy', () => {
    expect(ACTIVE_LOCALES).toHaveLength(11);
    for (const key of keys) expect(en[key]).toBeTruthy();
    for (const locale of ACTIVE_LOCALES.filter(value => value !== 'en')) {
        for (const key of keys) {
            const value = APP_CATALOGS[locale as Exclude<typeof locale, 'en'>][key];
            expect(typeof value).toBe('string'); expect(value).not.toBe(key); expect(value).not.toBe(en[key]);
        }
    }
});
