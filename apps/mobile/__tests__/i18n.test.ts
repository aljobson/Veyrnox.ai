import { createTranslator, fill } from '../src/lib/i18n/translate';
import { isRtl, matchTag, resolveLocale } from '../src/lib/i18n/locales';
import { getLocale, setLocaleFromDevice, t } from '../src/lib/i18n';
import en from '../src/lib/i18n/messages/en';

describe('locale detection', () => {
    test('maps regional and script tags to the shipped code', () => {
        expect(matchTag('pt-BR')).toBe('pt');
        expect(matchTag('zh-Hans-CN')).toBe('zh');
        expect(matchTag('en_GB')).toBe('en');
        expect(matchTag('sv-SE')).toBeNull();
        expect(matchTag('')).toBeNull();
    });
    test('takes the first preferred language we ship, else English', () => {
        expect(resolveLocale(['sv-SE', 'de-AT', 'fr'])).toBe('de');
        expect(resolveLocale(['sv', 'nb'])).toBe('en');
        expect(resolveLocale([])).toBe('en');
    });
    test('only Arabic is right to left', () => {
        expect(isRtl('ar')).toBe(true);
        expect(isRtl('en')).toBe(false);
        expect(isRtl('ja')).toBe(false);
    });
});

describe('translator', () => {
    const catalogs = {
        en: { hi: 'Hello {name}', only: 'English only', 'n.one': '{count} file', 'n.other': '{count} files' },
        es: { hi: 'Hola {name}', 'n.one': '{count} archivo', 'n.other': '{count} archivos' },
        ar: { 'n.zero': 'لا ملفات', 'n.other': '{count} ملف' },
    };
    test('uses the locale, then English, then the key', () => {
        const es = createTranslator('es', catalogs);
        expect(es.t('hi', { name: 'Ana' })).toBe('Hola Ana');
        expect(es.t('only')).toBe('English only');
        expect(es.t('missing.key')).toBe('missing.key');
    });
    test('a locale with no catalog reads English', () => {
        expect(createTranslator('ko', catalogs).t('hi', { name: 'Min' })).toBe('Hello Min');
    });
    test('leaves a slot with no value as written', () => {
        expect(fill('a {x} b {y}', { x: 1 })).toBe('a 1 b {y}');
    });
    test('picks the plural category and falls back to other', () => {
        const es = createTranslator('es', catalogs);
        expect(es.plural('n', 1)).toBe('1 archivo');
        expect(es.plural('n', 5)).toBe('5 archivos');
        const ar = createTranslator('ar', catalogs);
        expect(ar.plural('n', 0)).toBe('لا ملفات');
        expect(ar.plural('n', 1)).toBe('1 ملف'); // Arabic "one" has no entry, so other
        expect(createTranslator('en', catalogs).plural('absent', 2)).toBe('absent');
    });
});

describe('app translator', () => {
    test('defaults to English and follows the device', () => {
        expect(getLocale()).toBe('en');
        expect(setLocaleFromDevice(['de-DE'])).toBe('de');
        expect(t('net.offline')).toBe(en['net.offline']); // no German catalog yet: English, not a key
        setLocaleFromDevice(['en-US']);
    });
});
