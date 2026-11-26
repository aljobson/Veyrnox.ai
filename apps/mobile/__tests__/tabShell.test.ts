// The five-tab shell (ADR-0146). The (tabs) folder is a route group, so these checks keep every URL the same, every tab
// named in the English catalog, and the sign-in redirects pointed at a route that exists.
import en from '../src/lib/i18n/messages/en';
declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { existsSync: (p: string) => boolean; readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

const APP = path.join(__dirname, '..', 'src', 'app');
const TABS = path.join(APP, '(app)', '(tabs)');
const read = (f: string) => fs.readFileSync(f, 'utf8');

const ORDER = ['index', 'create', 'editor', 'library', 'publish'];

describe('tab shell', () => {
    test('only the tab scenes receive landscape side insets', () => {
        const layout = read(path.join(TABS, '_layout.tsx'));
        expect(layout).toContain('useSafeAreaInsets()');
        expect(layout).toContain('paddingLeft: insets.left, paddingRight: insets.right');
    });

    test('the five tab screens live in the (tabs) group, and nowhere else', () => {
        for (const name of ORDER) {
            expect(fs.existsSync(path.join(TABS, `${name}.tsx`))).toBe(true);
        }
        // The old homes would make two screens for one URL.
        expect(fs.existsSync(path.join(APP, '(app)', 'index.tsx'))).toBe(false);
        expect(fs.existsSync(path.join(APP, '(app)', 'library.tsx'))).toBe(false);
        expect(fs.existsSync(path.join(APP, '(app)', 'publish.tsx'))).toBe(false);
        expect(fs.existsSync(path.join(APP, '(app)', 'create', 'index.tsx'))).toBe(false);
        expect(fs.existsSync(path.join(APP, '(app)', 'cinema', 'index.tsx'))).toBe(true);
    });

    test('the layout lists the tabs in order, each with a visible and a spoken label from the catalog', () => {
        const layout = read(path.join(TABS, '_layout.tsx'));
        const named = [...layout.matchAll(/<Tabs\.Screen\s+name="(\w+)"/g)].map((m) => m[1]);
        expect(named).toEqual(ORDER);
        for (const key of ['explore', 'create', 'studio', 'cinema', 'library', 'publish', 'account']) {
            expect((en as Record<string, string>)[`tabs.${key}`]).toEqual(expect.any(String));
        }
        // Every tab has its own spoken label and its label growth is capped like the header's.
        expect(layout.match(/tabBarAccessibilityLabel/g)?.length).toBe(ORDER.length);
        expect(layout).toContain("focused && name === 'house' ? 'houseFill'");
        expect(layout).toContain("focused && name === 'sparkle' ? 'sparkleFill'");
        expect(layout).toContain('maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}');
    });

    test('Editor keeps the stable editor route and does not duplicate music or workflow navigation', () => {
        const layout = read(path.join(TABS, '_layout.tsx'));
        const editor = read(path.join(TABS, 'editor.tsx'));
        expect(layout).toContain("title: t('editor.title')");
        expect(layout).toContain("tabBarIcon: tabIcon('scissors')");
        expect(layout).not.toContain('href: EDITOR_ENABLED');
        expect(editor).toContain("pathname: '/editor/new', params: { blank: '1', add: '1' }");
        expect(editor).toContain("pathname: '/editor/[projectId]'");
        expect(editor).not.toContain("mobileFeature('beats')");
        expect(editor).not.toContain("mobileFeature('features')");
        // Cinema remains available through the registry-backed drawer after giving its tab slot to Editor.
        expect(read(path.join(__dirname, '..', 'src', 'lib', 'featureRegistry.ts'))).toContain("href: '/cinema'");
    });

    test('the tab header carries global search, credits and the avatar', () => {
        const layout = read(path.join(TABS, '_layout.tsx'));
        expect(layout).toMatch(/headerRight:\s*\(\)\s*=>\s*<HeaderRight/);
        const chips = read(path.join(__dirname, '..', 'src', 'components', 'HeaderChips.tsx'));
        expect(chips).toContain("router.push('/search')");
        expect(chips).toContain("router.push('/credits')");
        expect(chips).toContain("router.push('/account')");
    });

    test('the sign-in redirects open the tab group, not the removed (app) index', () => {
        for (const f of ['index.tsx', 'email.tsx', 'sign-in.tsx']) {
            const text = read(path.join(APP, f));
            expect(text).not.toMatch(/'\/\(app\)'/);
        }
        expect(read(path.join(APP, 'index.tsx'))).toContain("'/(app)/(tabs)'");
    });

    test('the stack hides its own header over the tabs', () => {
        expect(read(path.join(APP, '(app)', '_layout.tsx'))).toMatch(/name="\(tabs\)" options=\{\{ headerShown: false \}\}/);
    });
});
