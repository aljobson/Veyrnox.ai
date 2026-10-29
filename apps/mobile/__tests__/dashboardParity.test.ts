declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

describe('the native Explore dashboard mirrors the signed-in website', () => {
    const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
    const explore = read('app', '(app)', '(tabs)', 'index.tsx');

    test('keeps one selected app palette from the page through the header and tab bar', () => {
        const tabs = read('app', '(app)', '(tabs)', '_layout.tsx');
        expect(explore).toContain('useAppearance()');
        expect(explore).toContain("<StatusBar style={scheme === 'dark' ? 'light' : 'dark'}");
        expect(tabs).toContain('const palette = paletteForScheme(scheme, settings)');
        expect(tabs).toContain('headerStyle: { backgroundColor: palette.background }');
        expect(tabs).toContain('<Logo size={20} palette={palette} />');
        expect(tabs).toContain('tabBarStyle: { backgroundColor: palette.background');
    });

    test('keeps the creator-first website hierarchy and price-forward preset cards', () => {
        expect(explore).toContain("t('explore.start.title')");
        expect(explore).toContain('<StartOption href="/create"');
        expect(explore).toContain('<StartOption href="/chat"');
        expect(explore).toContain('<StartOption href="/film"');
        expect(explore).toContain('oddling-body-chaos.webp');
        expect(explore).toContain("t('explore.heroTitle')");
        expect(explore.indexOf('<StartOption href="/chat"')).toBeLessThan(explore.indexOf('oddling-body-chaos.webp'));
        expect(explore).toContain('presetPrice(preset)');
        expect(explore).toContain('styles.grid');
    });
});

describe('the native Create dashboard mirrors the website Studio', () => {
    const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
    const create = read('app', '(app)', '(tabs)', 'create.tsx');

    test('carries the selected light or dark shell onto the Create tab', () => {
        const tabs = read('app', '(app)', '(tabs)', '_layout.tsx');
        expect(create).toContain('useAppearance()');
        expect(create).toContain('useThemedStyles(sheets)');
        expect(create).toContain("<StatusBar style={scheme === 'dark' ? 'light' : 'dark'}");
        expect(tabs).toContain('const palette = paletteForScheme(scheme, settings)');
    });

    test('starts from a goal and shortcuts, with no model list and no prices', () => {
        expect(create).toContain("t('create.startFrom')");
        expect(create).toContain("t('create.what')");
        expect(create).toContain('starterModel(');
        expect(create).not.toContain("t('create.model')");
        expect(create).not.toContain("t('create.livePrices')");
        expect(create).not.toContain("plural('create.from'");
        expect(create).toContain("pathname: '/create/[modelId]'");
    });
});
