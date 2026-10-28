const locales = ['es', 'zh', 'hi', 'ar', 'fr', 'pt', 'ru', 'ja', 'de', 'ko'] as const;
const evaluated = new Set<string>();
let stored: string | null = null;
let device = 'en-GB';

beforeEach(() => {
    evaluated.clear(); stored = null; device = 'en-GB';
    jest.resetModules();
    jest.doMock('../src/lib/languageStore', () => ({ readLanguage: () => stored }));
    jest.doMock('../src/lib/i18n/device', () => ({
        ...jest.requireActual('../src/lib/i18n/device'), readDeviceSources: () => ({ iosLanguages: [device] }),
    }));
    for (const locale of locales) {
        for (const area of ['', 'app/']) {
            const path = `../src/lib/i18n/messages/${area}${locale}`;
            jest.doMock(path, () => { evaluated.add(`${area}${locale}`); return jest.requireActual(path); });
        }
    }
});

test.each(['stored', 'device'])('the %s startup locale is translated synchronously with only its catalogs evaluated', source => {
    if (source === 'stored') stored = 'es'; else device = 'es-MX';
    const i18n = require('../src/lib/i18n');
    expect(i18n.getLocale()).toBe('es');
    expect(i18n.t('home.chat')).toBe(i18n.CATALOGS.es['home.chat']);
    expect(i18n.t('home.chat')).not.toBe(i18n.CATALOGS.en['home.chat']);
    expect([...evaluated].sort()).toEqual(['app/es', 'es']);
});

test('English startup and enumeration are lazy; switching synchronously loads and caches the selected locale', () => {
    const i18n = require('../src/lib/i18n');
    expect(i18n.getLocale()).toBe('en');
    expect(Object.keys(i18n.CATALOGS)).toHaveLength(11);
    expect(Object.keys(i18n.APP_CATALOGS)).toHaveLength(10);
    expect(evaluated.size).toBe(0);
    expect(i18n.chooseLocale('ja-JP')).toBe(true);
    const japanese = i18n.CATALOGS.ja;
    expect(i18n.t('home.chat')).toBe(japanese['home.chat']);
    expect([...evaluated].sort()).toEqual(['app/ja', 'ja']);
    i18n.setLocaleFromDevice(['de-DE']);
    expect(i18n.t('home.chat')).toBe(i18n.CATALOGS.de['home.chat']);
    device = 'fr-FR'; i18n.applyDeviceLocale();
    expect(i18n.t('home.chat')).toBe(i18n.CATALOGS.fr['home.chat']);
    i18n.chooseLocale('ja');
    expect(i18n.CATALOGS.ja).toBe(japanese);
});

test('every locale remains enumerable, loadable and merged with website precedence', () => {
    const i18n = require('../src/lib/i18n');
    for (const locale of locales) {
        i18n.chooseLocale(locale);
        expect(i18n.CATALOGS[locale]).toEqual({ ...i18n.APP_CATALOGS[locale], ...i18n.WEB_CATALOGS[locale] });
        expect(i18n.t('home.chat')).toBe(i18n.CATALOGS[locale]['home.chat']);
    }
    expect(evaluated.size).toBe(20);
});
