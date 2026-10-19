import { ACTIVE_LOCALES, CATALOGS, applyDeviceLocale, createTranslator, getLocale, LOCALE_CODES } from '../src/lib/i18n';
import en from '../src/lib/i18n/messages/en';
import webKeys from '../src/lib/i18n/webKeys.json';

// The app has no Node type definitions (and takes no new dependency for a test), so the two Node pieces this file
// needs are declared here.
declare const require: (id: string) => any;
declare const __dirname: string;
const { readFileSync } = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string };
const join = (...parts: string[]): string => (require('path') as { join: (...p: string[]) => string }).join(...parts);

const root = join(__dirname, '..');
const repo = join(root, '..', '..');

// The public site's catalog files are plain `export default { ... }` modules with no imports.
function readWebCatalog(code: string): Record<string, string> {
    const text = readFileSync(join(repo, 'lib', 'i18n', 'messages', `${code}.mjs`), 'utf8').replace(/^export default\s+/m, 'return ');
    return new Function(text)() as Record<string, string>;
}

const SCOPE = [
    'src/app/sign-in.tsx',
    'src/app/email.tsx',
    'src/app/(app)/index.tsx',
    'src/app/(app)/create/index.tsx',
    'src/app/(app)/create/[modelId].tsx',
    'src/app/(app)/job/[id].tsx',
    'src/app/(app)/library.tsx',
    'src/app/(app)/account.tsx',
    'src/app/(app)/credits.tsx',
    'src/lib/auth/emailForm.ts',
];
const source = (file: string) => readFileSync(join(root, file), 'utf8');
const slots = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('every key a screen asks for exists in the English catalog', () => {
    test.each(SCOPE)('%s', (file) => {
        const text = source(file);
        const asked = [...text.matchAll(/\b(?:t|plural)\(\s*['`]([A-Za-z0-9_.]+)['`]/g)].map((m) => ({ key: m[1], plural: /plural\(\s*['`]$/.test(text.slice(0, (m.index ?? 0) + m[0].length - m[1].length - 1)) }));
        const catalog = en as Record<string, string>;
        for (const { key, plural } of asked) {
            if (plural) expect(`${key}.other` in catalog).toBe(true);
            else expect(key in catalog).toBe(true);
        }
    });

    test('keys named in lookup tables are in the catalog too', () => {
        const catalog = en as Record<string, string>;
        const tables = SCOPE.flatMap((f) => [...source(f).matchAll(/'((?:library|job|email\.err|form|model\.media)\.[A-Za-z_.]+)'/g)].map((m) => m[1] as string));
        // A plural base ('form.costs') is present as its '.other' form.
        for (const key of tables) expect(key in catalog || `${key}.other` in catalog).toBe(true);
    });
});

describe('strings shared with the public site keep its key and its exact English', () => {
    const web = readWebCatalog('en');
    test.each(webKeys)('%s', (key) => {
        expect((en as Record<string, string>)[key]).toBe(web[key]);
    });
});

describe('the generated language catalogs are the site translations, verbatim', () => {
    const codes = LOCALE_CODES.filter((c) => c !== 'en');
    test.each(codes)('%s', (code) => {
        const own = CATALOGS[code] as Record<string, string>;
        const web = readWebCatalog(code);
        const english = en as Record<string, string>;
        for (const [key, value] of Object.entries(own)) {
            expect(webKeys).toContain(key);
            expect(value).toBe(web[key]);
            expect(slots(value)).toEqual(slots(english[key] ?? ''));
        }
        // Everything the site translates for these keys is carried over.
        expect(Object.keys(own).sort()).toEqual(webKeys.filter((k) => typeof web[k] === 'string').sort());
    });
});

describe('English is on, and turning a language on shows its translation with English for the rest', () => {
    test('only English is active, so no device language changes the screens today', () => {
        expect(ACTIVE_LOCALES).toEqual(['en']);
        expect(applyDeviceLocale()).toBe('en');
        expect(getLocale()).toBe('en');
    });
    test('a language added to the active list reads its site translation, then English, never a bare key', () => {
        const es = createTranslator('es', CATALOGS);
        expect(es.t('label.Library')).toBe(readWebCatalog('es')['label.Library']);
        expect(es.t('home.chat')).toBe('Chat with Vey');
        expect(es.plural('home.credits', 1)).toBe('1 credit');
        expect(es.plural('home.credits', 5)).toBe('5 credits');
    });
});

describe('no visible English is left hardcoded in the wired screens', () => {
    const screens = SCOPE.filter((f) => f.endsWith('.tsx'));
    test.each(screens)('%s', (file) => {
        // JSX text between tags that starts with a capital letter and reads as words; code and {expressions} are not text.
        const text = source(file).replace(/\/\/.*$/gm, '');
        const stray = [...text.matchAll(/>\s*([A-Z][a-z]+(?:\s+[A-Za-z][a-z']+)+[^<>{}\n]*)\s*</g)].map((m) => m[1]);
        expect(stray).toEqual([]);
    });
});

describe('the list for the localization process is current', () => {
    test('every app-only key in the English catalog is listed in docs/mobile/I18N-NEW-KEYS.md', () => {
        const doc = readFileSync(join(repo, 'docs', 'mobile', 'I18N-NEW-KEYS.md'), 'utf8');
        for (const key of Object.keys(en)) if (!webKeys.includes(key)) expect(doc).toContain(`\`${key}\``);
    });
});
