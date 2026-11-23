import en from '../src/lib/i18n/messages/en';
import { MENU_FOOTER, MENU_SECTIONS } from '../src/lib/menu';
import {
    ERROR_STATE_ROUTE_TAGS,
    INTERACTION_CRAWL_ROUTE_EXCLUSIONS,
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
            'credits',
            'delete-account',
            'paywall',
            'pricing',
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
    test.each(['e2e.config.ts', 'e2e.crawl.config.ts'])('%s accepts an E2E_DEVICE override and keeps the target label', (file) => {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        expect(source).toContain("process.env.E2E_DEVICE ?? 'iPhone 17 Pro'");
        expect(source).toMatch(/device:\s*e2eDevice/);
        expect(source).toMatch(/name:\s*'ios-simulator'/);
    });
});

test('the drawer E2E labels cannot drift from the production menu registry', () => {
    const catalog = en as Record<string, string>;
    const registryLabels = [...MENU_SECTIONS.flatMap((section) => section.items), ...MENU_FOOTER]
        .map((item) => catalog[item.label]);
    expect(NAVIGATION_MENU_LABELS).toEqual(registryLabels);
});

test('the bounded landscape/keyboard smoke uses supported deterministic device APIs', () => {
    const source = fs.readFileSync(path.join(ROOT, 'tests', 'layout-smoke.e2e.ts'), 'utf8');
    expect(source.match(/device\.setOrientation\('landscape-left'\)/g)).toHaveLength(4);
    expect(source).toContain('prompt.pressSequentially');
    expect(source).toContain('device.dismissKeyboard()');
    expect(source).toContain("device.setOrientation('portrait')");
    expect(source).toContain("device.openLink('ai.veyrnox.app://editor')");
    expect(source).toContain("getByRole('button', 'Beats')");
    expect(source).toContain("getByRole('button', 'Professional')");
    expect(source).toContain("device.openLink('ai.veyrnox.app://email')");
    expect(source).toContain("getByRole('button', 'English')");
    expect(source).toContain("getByRole('button', 'Continue', { exact: true }).tap()");
    expect(source).toContain("getByRole('textbox', 'Email')");
    expect(source).toContain("getByRole('button', 'Sign in and start creating')");
    expect(source).toContain("getByTestId('hard-paywall')");
    expect(source).toContain("getByRole('button', 'Not now')");
    expect(source).toContain("EXPO_PUBLIC_HARD_PAYWALL_ENABLED === 'true'");
    const paywallCase = source.slice(source.indexOf("test('the hard paywall"));
    expect(paywallCase).not.toMatch(/\.tap\s*\(/);
    expect(source).not.toMatch(/setTimeout|waitForTimeout/);
});
