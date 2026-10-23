declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

describe('the native Explore dashboard mirrors the signed-in website', () => {
    const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
    const explore = read('app', '(app)', '(tabs)', 'index.tsx');

    test('uses the website Studio palette from header through tab bar', () => {
        const tabs = read('app', '(app)', '(tabs)', '_layout.tsx');
        expect(explore).toContain('studioColors as colors');
        expect(tabs).toContain("route.name === 'index' || route.name === 'create' ? studioColors : colors");
        expect(tabs).toContain('headerStyle: { backgroundColor: palette.background }');
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

    test('carries the dark Studio shell onto the Create tab', () => {
        const tabs = read('app', '(app)', '(tabs)', '_layout.tsx');
        expect(create).toContain('studioColors as colors');
        expect(tabs).toContain("route.name === 'index' || route.name === 'create'");
    });

    test('orders sources, goal, price tier and live-priced models before navigation', () => {
        expect(create).toContain("t('create.startFrom')");
        expect(create).toContain("t('create.what')");
        expect(create).toContain("t('create.livePrices')");
        expect(create).toContain("t('create.priceExplainer')");
        expect(create).toContain("plural('create.from', item.credits)");
        expect(create).toContain("pathname: '/create/[modelId]'");
    });
});
