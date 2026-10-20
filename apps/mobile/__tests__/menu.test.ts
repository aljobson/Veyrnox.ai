// The grouped drawer menu: every entry opens a screen that exists and is named in the English catalog.
import en from '../src/lib/i18n/messages/en';
import { MENU_SECTIONS } from '../src/lib/menu';
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
    test('has the four web sections in order', () => {
        expect(MENU_SECTIONS.map((s) => s.id)).toEqual(['agents', 'tools', 'assets', 'inspire']);
    });

    test('every entry and heading is in the English catalog', () => {
        const catalog = en as Record<string, string>;
        for (const section of MENU_SECTIONS) {
            expect(catalog[section.label]).toEqual(expect.any(String));
            for (const item of section.items) expect(catalog[item.label]).toEqual(expect.any(String));
        }
        for (const key of ['menu.open', 'menu.close', 'menu.home', 'menu.sectionOpen', 'menu.sectionClosed']) {
            expect(catalog[key]).toEqual(expect.any(String));
        }
    });

    test('every entry opens a screen that exists', () => {
        for (const item of MENU_SECTIONS.flatMap((s) => s.items)) {
            expect(ROUTE_FILES(item.href).some((f) => fs.existsSync(f))).toBe(true);
        }
    });

    test('entries are unique', () => {
        const hrefs = MENU_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
        expect(new Set(hrefs).size).toBe(hrefs.length);
    });

    test('the tab header carries the menu button on the left', () => {
        const layout = fs.readFileSync(path.join(APP, '(tabs)', '_layout.tsx'), 'utf8');
        expect(layout).toMatch(/headerLeft:\s*\(\)\s*=>\s*<MenuButton/);
    });
});
