declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string; existsSync: (p: string) => boolean };
const path = require('path') as { join: (...p: string[]) => string };
const src = (...p: string[]) => path.join(__dirname, '..', 'src', ...p);
const read = (...p: string[]) => fs.readFileSync(src(...p), 'utf8');

// The signed-out preview (N2): browse templates and the Cinema list before an account. Playing, creating and buying
// ask to sign in. Only the public, anonymous reads are used.
describe('the signed-out preview', () => {
    const screen = read('app', 'preview.tsx');

    test('is a route outside the signed-in area, so it needs no account', () => {
        expect(fs.existsSync(src('app', 'preview.tsx'))).toBe(true);
        expect(fs.existsSync(src('app', '(app)', 'preview.tsx'))).toBe(false);
    });

    test('reads only the public template list and the public Cinema list', () => {
        expect(screen).toContain('fetchPresets()');
        expect(screen).toContain('fetchTitlesPage(');
        expect(screen).not.toContain('useAuth().api');
        expect(screen).not.toContain('api.request');
    });

    test('every action asks to sign in; nothing plays, creates or buys', () => {
        expect(screen).toContain("router.push('/sign-in')");
        expect(screen).not.toContain("'/cinema/watch");
        expect(screen).not.toContain("'/create/");
        expect(screen).not.toContain("'/credits'");
    });

    test('a signed-in person is sent to the app instead', () => {
        expect(screen).toContain("status === 'signedIn'");
        expect(screen).toContain('<Redirect href="/"');
    });

    test('sign-in offers it, ahead of any account, as a browse-first button', () => {
        const signIn = read('app', 'sign-in.tsx');
        expect(signIn).toContain('href="/preview"');
        expect(signIn).toContain("t('preview.browse')");
    });

    test('has its own top bar inside the safe area, with a Back button, since the root has no header', () => {
        expect(screen).toContain('useSafeAreaInsets()');
        expect(screen).toContain('paddingTop: insets.top');
        expect(screen).toContain("t('preview.back')");
        expect(screen).not.toContain('Stack.Screen');
    });

    test('tabs are labelled and the list headings announce themselves', () => {
        expect(screen).toContain("'preview.tab.templates'");
        expect(screen).toContain("'preview.tab.cinema'");
        expect(screen).toContain('accessibilityRole="tab"');
        expect(screen).toContain('accessibilityRole="header"');
    });
});
