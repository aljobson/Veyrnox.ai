declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
const exists = (...p: string[]) => {
    try {
        read(...p);
        return true;
    } catch {
        return false;
    }
};

// Vey is a character in the app (onboarding, celebrations, paywall peeks), not a chat bot (ADR-0265).
describe('Vey is not a chat bot', () => {
    test('no floating Vey opens chat from the tabs', () => {
        expect(exists('components', 'VeyMascot.tsx')).toBe(false);
        expect(exists('lib', 'veyPlacement.ts')).toBe(false);
        expect(exists('lib', 'useVeyScroll.ts')).toBe(false);
        const layout = read('app', '(app)', '(tabs)', '_layout.tsx');
        expect(layout).not.toContain('Vey');
        expect(layout).not.toContain('screenLayout');
    });

    test('Help has no Ask Vey question box', () => {
        const help = read('app', '(app)', 'help.tsx');
        expect(help).not.toMatch(/help\.ask|help\.answer|askHelp|TextInput/);
        expect(exists('lib', 'help.ts')).toBe(false);
    });

    test('search and the chat transcript do not present the chat as Vey', () => {
        expect(read('lib', 'siteSearch.ts')).toContain("{ id: 'chat', titleKey: 'menu.chat', href: '/chat'");
        expect(read('lib', 'siteSearch.ts')).not.toMatch(/srch\.s\.chat|keywords: '[^']*vey/);
        expect(read('app', '(app)', 'chat', '[id].tsx')).not.toMatch(/'Vey'/);
    });

    // The launchpad keeps one explicit LLM Chat choice alongside Create and Film Studio.
    test('the home has one LLM Chat choice in the primary launchpad', () => {
        const home = read('app', '(app)', '(tabs)', 'index.tsx');
        expect(home.split('href="/chat"').length - 1).toBe(1);
        expect(home).toContain("title={t('menu.chat')}");
        expect(home.indexOf('href="/create"')).toBeLessThan(home.indexOf('href="/chat"'));
        expect(home.indexOf('href="/chat"')).toBeLessThan(home.indexOf('href="/oddlings"'));
    });
});
