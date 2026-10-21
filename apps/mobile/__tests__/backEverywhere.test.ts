// Like the neighbouring wiring tests, guard the native surface without a native build.
declare const require: (id: string) => any;
declare const __dirname: string;
const { readFileSync } = require('fs');
const { join } = require('path');
const read = (file: string): string => readFileSync(join(__dirname, '..', 'src', file), 'utf8');

test('a screen with no history still has a way back (to Explore)', () => {
    const layout = read('app/(app)/_layout.tsx');
    expect(layout).toContain('navigation.canGoBack()');
    expect(layout).toContain('<HomeBackButton />');
    const button = read('components/HomeBackButton.tsx');
    expect(button).toContain("router.replace('/')");
    expect(button).toContain("accessibilityLabel={t('public.vey.back')}");
});

test('the welcome cards after the first have a Back', () => {
    const welcome = read('app/(app)/welcome.tsx');
    expect(welcome).toContain('setIndex(index - 1)');
    expect(welcome).toContain("t('public.vey.back')");
});
