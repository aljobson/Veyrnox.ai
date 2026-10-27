import { isolateNumbers, isLegalDoc, legalData, legalDocs, legalLink, legalUpdated, type LegalBlock } from '../src/lib/legal';
import { loaders } from '../src/lib/legal/generated/loaders';
declare const require: (id: string) => any;
declare const __dirname: string;
const { execFileSync } = require('child_process');
const { join } = require('path');
test('generated legal data matches the website', () => {
    expect(() => execFileSync('node', ['scripts/sync-web-legal.mjs', '--check'], { cwd: join(__dirname, '..') })).not.toThrow();
});
test.each(Object.keys(loaders))('every document and nested slot resolves in %s', locale => {
    for (const doc of legalDocs) {
        const data = legalData(doc, locale);
        expect(data.messages.title).toBeTruthy();
        expect(data.jurisdiction).toBeTruthy();
        function visit(block: LegalBlock) {
            if (block.key) {
                expect(typeof data.messages[block.key]).toBe('string');
                const slots = [...data.messages[block.key].matchAll(/\{(\w+)\}/g)].map(m => m[1]);
                slots.forEach(slot => expect(slot in data.entity || slot in (block.slots ?? {})).toBe(true));
            }
            block.children?.forEach(visit);
            Object.values(block.slots ?? {}).forEach(visit);
        }
        data.blocks.forEach(visit);
    }
});
test('locale fallback, localized jurisdiction, dates and Arabic number isolation', () => {
    expect(legalData('terms', 'unknown').locale).toBe('en');
    expect(legalData('terms', 'constructor').locale).toBe('en');
    expect(isLegalDoc('constructor')).toBe(false);
    expect(legalData('terms', 'ar').entity.jurisdiction).toBe('إنجلترا وويلز');
    expect(legalUpdated('13 October 2026', 'fr', 'fr')).toBe('13 octobre 2026');
    expect(isolateNumbers('14 days, 1,234.50 and 20%', 'ar')).toBe('\u206614\u2069 days, \u20661,234.50\u2069 and \u206620%\u2069');
    expect(isolateNumbers('14 days', 'en')).toBe('14 days');
});
test.each(['/legal/privacy', '/fr/legal/privacy', 'https://veyrnox.ai/legal/privacy'])('%s navigates natively', href => {
    expect(legalLink(href)).toEqual({ kind: 'legal', doc: 'privacy' });
});
test('legal fragments survive cross-document and same-document navigation', () => {
    expect(legalLink('/legal/privacy#account-deletion')).toEqual({ kind: 'legal', doc: 'privacy', anchor: 'account-deletion' });
    expect(legalLink('#account%2Ddeletion', 'privacy')).toEqual({ kind: 'legal', doc: 'privacy', anchor: 'account-deletion' });
    expect(legalLink('https://veyrnox.ai/fr/legal/privacy?source=gdpr#youtube')).toEqual({ kind: 'legal', doc: 'privacy', anchor: 'youtube' });
    expect(legalLink('/legal/privacy#%bad')).toEqual({ kind: 'legal', doc: 'privacy', anchor: '%bad' });
    expect(legalLink('/legal/privacy#')).toEqual({ kind: 'legal', doc: 'privacy' });
});
test('only mailto links are external actions; regulators and other schemes are plain addresses', () => {
    expect(legalLink('mailto:legal@veyrnox.com')).toEqual({ kind: 'mail', href: 'mailto:legal@veyrnox.com' });
    for (const href of ['https://ico.org.uk', 'javascript:alert(1)', 'https://veyrnox.ai.evil/legal/privacy', 'otpauth:foo', '//evil/legal/terms']) expect(legalLink(href).kind).toBe('plain');
});
