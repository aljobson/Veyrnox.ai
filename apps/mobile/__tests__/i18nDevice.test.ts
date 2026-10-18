import { createTranslator } from '../src/lib/i18n';
import { deviceLanguageTags, resolveActive, splitSlots } from '../src/lib/i18n/device';

describe('deviceLanguageTags', () => {
    test('uses the iOS language list first, then Android, then Intl, without repeats', () => {
        expect(deviceLanguageTags({ iosLanguages: ['fr-FR', 'en-GB'], androidLocale: 'de_DE', intlLocale: 'en-US' })).toEqual(['fr-FR', 'en-GB', 'de_DE', 'en-US']);
        expect(deviceLanguageTags({ androidLocale: 'pt_BR', intlLocale: 'pt-BR' })).toEqual(['pt_BR', 'pt-BR']);
    });
    test('ignores missing and non-text entries', () => {
        expect(deviceLanguageTags({ iosLanguages: [null as unknown as string, '', 'es-ES'], androidLocale: null, intlLocale: undefined })).toEqual(['es-ES']);
        expect(deviceLanguageTags({})).toEqual([]);
    });
});

describe('resolveActive', () => {
    test('the first device language that is active wins, and a region tag maps to its language', () => {
        expect(resolveActive(['pt-BR', 'en'], ['en', 'pt'])).toBe('pt');
        expect(resolveActive(['fr-FR', 'es-ES'], ['en', 'es'])).toBe('es');
    });
    test('a language that is shipped but not active reads English', () => {
        expect(resolveActive(['de-DE'], ['en'])).toBe('en');
        expect(resolveActive([], ['en', 'es'])).toBe('en');
        expect(resolveActive(['xx-YY'], ['en', 'es'])).toBe('en');
    });
});

describe('splitSlots', () => {
    test('puts the named slots where the translation puts them, in any word order', () => {
        expect(splitSlots('I agree to the {terms} and {privacy}.', ['terms', 'privacy'])).toEqual(['I agree to the ', { slot: 'terms' }, ' and ', { slot: 'privacy' }, '.']);
        expect(splitSlots('{privacy} と {terms} に同意します', ['terms', 'privacy'])).toEqual([{ slot: 'privacy' }, ' と ', { slot: 'terms' }, ' に同意します']);
    });
    test('text with no slot is one piece, and an unknown slot stays as written', () => {
        expect(splitSlots('Plain text', ['terms'])).toEqual(['Plain text']);
        expect(splitSlots('See {other}', ['terms'])).toEqual(['See {other}']);
    });
});

describe('a language turned on shows its translation and falls back to English', () => {
    const catalogs = { en: { 'label.Library': 'Library', 'home.chat': 'Chat with Vey' }, es: { 'label.Library': 'Biblioteca' } };
    test('translated key, then English for the rest', () => {
        const es = createTranslator('es', catalogs);
        expect(es.t('label.Library')).toBe('Biblioteca');
        expect(es.t('home.chat')).toBe('Chat with Vey');
        expect(es.t('nope.key')).toBe('nope.key');
    });
});
