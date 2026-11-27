import en from '../src/lib/i18n/messages/en';
import { MENU_FOOTER, MENU_SECTIONS } from '../src/lib/menu';
import {
    ERROR_STATE_ROUTE_TAGS,
    INTERACTION_CRAWL_ROUTE_EXCLUSIONS,
    LANDSCAPE_ORIENTATIONS,
    NAVIGATION_MENU_LABELS,
    STATIC_ROUTE_CRAWL_EXCLUSIONS,
    selectInventoryRoutes,
} from '../e2e.contracts';

declare const __dirname: string;
declare const require: (id: string) => any;

const fs = require('node:fs') as {
    readFileSync: (path: string, encoding: 'utf8') => string;
    readdirSync: (path: string, options: { withFileTypes: true }) => Array<{
        isDirectory: () => boolean;
        name: string;
    }>;
};
const path = require('node:path') as {
    join: (...parts: string[]) => string;
    relative: (from: string, to: string) => string;
};

const ROOT = path.join(__dirname, '..');
const APP_ROOT = path.join(ROOT, 'src', 'app');
const CRAWL_ROUTES = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'crawl-routes.json'), 'utf8')) as string[];

function staticAppRoutes(): string[] {
    const files: string[] = [];
    const visit = (directory: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(file);
            else if (/\.(?:ts|tsx)$/.test(entry.name) && !entry.name.startsWith('_')) files.push(file);
        }
    };
    visit(APP_ROOT);

    const routes = files.flatMap((file) => {
        const relative = path.relative(APP_ROOT, file).replace(/\\/g, '/').replace(/\.(?:ts|tsx)$/, '');
        const segments = relative.split('/');
        if (segments.some((segment) => segment.startsWith('['))) return [];
        const route = segments.filter((segment) => !/^\(.*\)$/.test(segment));
        if (route.at(-1) === 'index') route.pop();
        return [route.join('/')];
    });
    return [...new Set(routes)].sort();
}

describe('mobile E2E route inventory', () => {
    test('every static app route is swept or has one checked, reasoned exclusion', () => {
        const actual = staticAppRoutes();
        const excluded = Object.keys(STATIC_ROUTE_CRAWL_EXCLUSIONS);

        expect([...new Set(CRAWL_ROUTES)].sort()).toEqual([...CRAWL_ROUTES].sort());
        expect([...new Set([...CRAWL_ROUTES, ...excluded])].sort()).toEqual(actual);
        for (const [route, reason] of Object.entries(STATIC_ROUTE_CRAWL_EXCLUSIONS)) {
            expect(actual).toContain(route);
            expect(CRAWL_ROUTES).not.toContain(route);
            expect(reason.trim().length).toBeGreaterThan(12);
        }
    });

    test('purchase and destructive routes stay in the sweep but cannot enter the generic tap crawl', () => {
        const interactionRoutes = CRAWL_ROUTES.filter((route) => !(route in INTERACTION_CRAWL_ROUTE_EXCLUSIONS));

        expect(Object.keys(INTERACTION_CRAWL_ROUTE_EXCLUSIONS)).toEqual([
            'beats/new',
            'create',
            'create/agent',
            'credits',
            'delete-account',
            'dialogue',
            'faceless-reel',
            'music/create',
            'music/mashup',
            'music/render',
            'music/sample',
            'paywall',
            'pricing',
            'speech',
            'topups',
        ]);
        for (const [route, reason] of Object.entries(INTERACTION_CRAWL_ROUTE_EXCLUSIONS)) {
            expect(CRAWL_ROUTES).toContain(route);
            expect(interactionRoutes).not.toContain(route);
            expect(reason.trim().length).toBeGreaterThan(12);
        }
    });

    test('error-state screens are an inventory-derived, tagged subset', () => {
        const screens = selectInventoryRoutes(CRAWL_ROUTES, ERROR_STATE_ROUTE_TAGS);
        expect(screens).toHaveLength(Object.keys(ERROR_STATE_ROUTE_TAGS).length);
        expect(new Set(screens)).toEqual(new Set(Object.keys(ERROR_STATE_ROUTE_TAGS)));
        for (const reason of Object.values(ERROR_STATE_ROUTE_TAGS)) {
            expect(reason.trim().length).toBeGreaterThan(12);
        }
    });
});

describe('mobile E2E configuration contracts', () => {
    test.each([
        ['e2e.config.ts', 'ios-simulator'],
        ['e2e.crawl.config.ts', 'ios-simulator'],
        ['e2e.hard-paywall.config.ts', 'ios-hard-paywall'],
    ])('%s accepts an E2E_DEVICE override and keeps the target label', (file, label) => {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        expect(source).toContain("process.env.E2E_DEVICE ?? 'iPhone 17 Pro'");
        expect(source).toMatch(/device:\s*e2eDevice/);
        expect(source).toContain(`name: '${label}'`);
    });

    test('the hard-paywall runner cannot reuse or contaminate the default and crawl stacks', () => {
        const normalConfig = fs.readFileSync(path.join(ROOT, 'e2e.config.ts'), 'utf8');
        const paywallConfig = fs.readFileSync(path.join(ROOT, 'e2e.hard-paywall.config.ts'), 'utf8');
        const normalStack = fs.readFileSync(path.join(ROOT, 'dev', 'e2e-stack.mjs'), 'utf8');
        const crawlStack = fs.readFileSync(path.join(ROOT, 'dev', 'e2e-crawl-stack.mjs'), 'utf8');
        const paywallStack = fs.readFileSync(path.join(ROOT, 'dev', 'e2e-hard-paywall-stack.mjs'), 'utf8');

        expect(normalConfig).not.toContain('inheritEnv');
        expect(normalStack).toContain("EXPO_PUBLIC_HARD_PAYWALL_ENABLED: 'false'");
        expect(crawlStack).toContain("EXPO_PUBLIC_HARD_PAYWALL_ENABLED: 'false'");
        expect(paywallConfig).toContain("tests: 'tests/**/*.paywall.ts'");
        expect(paywallConfig).toContain("reuseExisting: false");
        expect(paywallConfig).toContain('http://localhost:8084');
        expect(paywallStack).toContain("EXPO_PUBLIC_HARD_PAYWALL_ENABLED: 'true'");
        expect(paywallStack).toContain("MOCK_PORT: '8804'");
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
        expect(pkg.scripts['test:e2e:hard-paywall']).toBe('e2e run --config e2e.hard-paywall.config.ts');
    });
});

test('the drawer E2E labels cannot drift from the production menu registry', () => {
    const catalog = en as Record<string, string>;
    const registryLabels = [...MENU_SECTIONS.flatMap((section) => section.items), ...MENU_FOOTER]
        .map((item) => catalog[item.label]);
    expect(NAVIGATION_MENU_LABELS).toEqual(registryLabels);
});

test('the native editor E2E uses the current Editor entry contract', () => {
    const source = fs.readFileSync(path.join(ROOT, 'tests', 'editor.e2e.ts'), 'utf8');
    expect(source).toContain("getByRole('button', 'Editor', { selected: true })");
    expect(source).toContain("getByRole('button', 'Professional')");
    expect(source).not.toContain("getByRole('button', 'New edit')");
});

test('the bounded landscape/keyboard smoke uses supported deterministic device APIs', () => {
    const source = fs.readFileSync(path.join(ROOT, 'tests', 'layout-smoke.e2e.ts'), 'utf8');
    const paywall = fs.readFileSync(path.join(ROOT, 'tests', 'hard-paywall.paywall.ts'), 'utf8');
    expect(LANDSCAPE_ORIENTATIONS).toEqual(['landscape-left', 'landscape-right']);
    expect(source).toContain('for (const orientation of LANDSCAPE_ORIENTATIONS)');
    expect(source).toContain('device.setOrientation(orientation)');
    expect(paywall).toContain('for (const orientation of LANDSCAPE_ORIENTATIONS)');
    expect(paywall).toContain('device.setOrientation(orientation)');
    expect(source).toContain('prompt.pressSequentially');
    expect(source).toContain('device.dismissKeyboard()');
    expect(source).toContain("device.setOrientation('portrait')");
    expect(source).toContain("device.openLink('ai.veyrnox.app://editor')");
    expect(source).toContain("getByRole('button', 'Beats')");
    expect(source).toContain("getByRole('button', 'Professional')");
    expect(source).toContain("device.openLink('ai.veyrnox.app://editor/new?blank=1')");
    expect(source).toContain("getByTestId('editor-tool-rail')");
    expect(source).toContain("getByTestId('timeline-ruler')");
    expect(source).toContain("device.openLink('ai.veyrnox.app://email')");
    expect(source).toContain("getByRole('button', 'English')");
    expect(source).toContain("getByRole('button', 'Continue', { exact: true }).tap()");
    expect(source).toContain("getByRole('textbox', 'Email')");
    expect(source).toContain("getByRole('button', 'Sign in and start creating')");
    expect(paywall).toContain("getByTestId('hard-paywall')");
    expect(paywall).toContain("getByRole('button', 'Not now')");
    expect(paywall).not.toMatch(/\.tap\s*\(/);
    expect(source).not.toMatch(/setTimeout|waitForTimeout/);
    expect(paywall).not.toMatch(/setTimeout|waitForTimeout/);
});

test('interaction purchase safety uses route and overlay contracts, not only English CTA text', () => {
    const source = fs.readFileSync(path.join(ROOT, 'tests', 'interaction-crawl.crawl.ts'), 'utf8');
    const paywall = fs.readFileSync(path.join(ROOT, 'src', 'components', 'paywall', 'PaywallSheet.tsx'), 'utf8');
    expect(source).toContain('INTERACTION_CRAWL_ROUTE_EXCLUSIONS');
    expect(source).toContain("screen.getByTestId('hard-paywall')");
    expect(source).toContain("screen.getByTestId('purchase-paywall')");
    expect(source).toContain('a purchase paywall overlay is visible');
    expect(paywall).toContain('testID="purchase-paywall"');
});
