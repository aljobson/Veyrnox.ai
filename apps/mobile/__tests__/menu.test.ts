// The grouped drawer menu: every entry opens a screen that exists and is named in the English catalog.
import en from '../src/lib/i18n/messages/en';
import { MENU_FOOTER, MENU_SECTIONS } from '../src/lib/menu';

const ALL_ITEMS = [...MENU_SECTIONS.flatMap((s) => s.items), ...MENU_FOOTER];
declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { existsSync: (p: string) => boolean; readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

const APP = path.join(__dirname, '..', 'src', 'app', '(app)');
const ROUTE_FILES = (href: string) => {
    const bare = href.replace(/^\//, '');
    return [path.join(APP, `${bare}.tsx`), path.join(APP, bare, 'index.tsx'), path.join(APP, '(tabs)', `${bare}.tsx`)];
};

describe('grouped menu', () => {
    test('matches the web sidebar: same groups, same order, Help at the foot', () => {
        expect(MENU_SECTIONS.map((s) => s.id)).toEqual(['tools', 'assets']);
        expect(MENU_SECTIONS.map((s) => [s.id, s.items.map((i) => i.key)])).toEqual([
            ['tools', ['create', 'editor', 'publish', 'cinema']],
            ['assets', ['library', 'brandKit', 'credits', 'chat']],
        ]);
        expect(MENU_FOOTER.map((i) => i.key)).toEqual(['help']);
    });

    test('each drawer item opens its mobile screen', () => {
        expect(Object.fromEntries(ALL_ITEMS.map((i) => [i.key, i.href]))).toEqual({
            create: '/create', editor: '/editor', publish: '/publish', cinema: '/cinema',
            library: '/library', brandKit: '/brand-kit', credits: '/credits', chat: '/chat', help: '/help',
        });
    });

    test('keeps the web key order inside each group', () => {
        // Web (studioNavigation.js) lists Audio between Create and Video editor; the phone has no Audio screen yet.
        const web = { tools: ['create', 'audio', 'editor', 'publish', 'cinema'], assets: ['library', 'brandKit', 'credits', 'chat'] };
        for (const section of MENU_SECTIONS) {
            const keys = section.items.map((i) => i.key);
            expect(web[section.id as 'tools' | 'assets'].filter((k) => keys.includes(k))).toEqual(keys);
        }
    });

    test('every entry and heading is in the English catalog', () => {
        const catalog = en as Record<string, string>;
        for (const section of MENU_SECTIONS) {
            expect(catalog[section.label]).toEqual(expect.any(String));
            for (const item of section.items) expect(catalog[item.label]).toEqual(expect.any(String));
        }
        for (const item of MENU_FOOTER) expect(catalog[item.label]).toEqual(expect.any(String));
        expect(catalog['menu.videoEditor']).toBe('Video editor');
        for (const key of ['menu.open', 'menu.close', 'menu.home', 'menu.sectionOpen', 'menu.sectionClosed']) {
            expect(catalog[key]).toEqual(expect.any(String));
        }
    });

    test('every entry opens a screen that exists', () => {
        for (const item of ALL_ITEMS) {
            expect(ROUTE_FILES(item.href).some((f) => fs.existsSync(f))).toBe(true);
        }
    });

    test('entries are unique', () => {
        const hrefs = ALL_ITEMS.map((i) => i.href);
        expect(new Set(hrefs).size).toBe(hrefs.length);
    });

    test('Social Cinema is named and directly available from the drawer', () => {
        expect((en as Record<string, string>)['menu.cinema']).toBe('Social Cinema');
        expect(MENU_SECTIONS.find((section) => section.id === 'tools')?.items).toContainEqual(
            expect.objectContaining({ key: 'cinema', href: '/cinema', label: 'menu.cinema', icon: 'slate' }),
        );
    });

    test('the tab header keeps the menu and wordmark leading-aligned away from trailing actions', () => {
        const layout = fs.readFileSync(path.join(APP, '(tabs)', '_layout.tsx'), 'utf8');
        expect(layout).toMatch(/headerLeft:\s*\(\)\s*=>\s*<MenuButton/);
        expect(layout).toContain("headerTitleAlign: 'left'");
    });
});

describe('the current screen in the menu', () => {
    // imported here, after the catalog test above, to keep the file's imports together
    const { activeItemKey } = require('../src/lib/menu') as { activeItemKey: (p: string) => string | null };

    test('Home is lit only on the home screen', () => {
        expect(activeItemKey('/')).toBe('home');
        expect(activeItemKey('/library')).toBe('library');
    });

    test('a screen inside a section lights its own item', () => {
        expect(activeItemKey('/cinema/watch/abc')).toBe('cinema');
        expect(activeItemKey('/chat/abc-123')).toBe('chat');
        expect(activeItemKey('/credits')).toBe('credits');
        expect(activeItemKey('/create/agent')).toBe('create');
        expect(activeItemKey('/editor/p-1')).toBe('editor');
        expect(activeItemKey('/publish/compose')).toBe('publish');
        expect(activeItemKey('/library/files')).toBe('library');
        expect(activeItemKey('/brand-kit')).toBe('brandKit');
        expect(activeItemKey('/help')).toBe('help');
    });

    test('screens not in the drawer light nothing but stay routable', () => {
        for (const href of ['/features', '/oddlings/x', '/projects', '/models', '/faceless-reel']) {
            expect(activeItemKey(href)).toBeNull();
        }
    });

    test('a screen that is not in the menu lights nothing', () => {
        expect(activeItemKey('/account')).toBeNull();
        expect(activeItemKey('/welcome')).toBeNull();
    });

    test('every menu icon has an image', () => {
        const { MENU_ICONS } = require('../src/lib/menuIcons') as { MENU_ICONS: Record<string, unknown> };
        for (const item of ALL_ITEMS) expect(MENU_ICONS[item.icon]).toBeDefined();
    });
});

test('Faceless reel is not repeated in the drawer', () => {
    expect(ALL_ITEMS.some(i => i.href === '/faceless-reel')).toBe(false);
});
