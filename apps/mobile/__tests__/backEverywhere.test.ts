// Like the neighbouring wiring tests, guard the native surface without a native build.
declare const require: (id: string) => any;
declare const __dirname: string;
const { readFileSync } = require('fs');
const { join } = require('path');
const read = (file: string): string => readFileSync(join(__dirname, '..', 'src', file), 'utf8');

test('a screen with no history still has a way back (to Explore)', () => {
    const layout = read('app/(app)/_layout.tsx');
    expect(layout).toContain('useCanGoBack()');
    expect(layout).toContain('<HomeBackButton />');
    const button = read('components/HomeBackButton.tsx');
    expect(button).toContain("router.replace('/')");
    expect(button).toContain("accessibilityLabel={t('public.vey.back')}");
});

test('the first-run questions after the first have a Back', () => {
    const firstRun = read('app/(app)/first-run.tsx');
    expect(firstRun).toContain('goBack(step - 1)');
    expect(firstRun).toContain("backLabel={t('public.vey.back')}");
});

test('the full-screen language flow has a visible Back with a cold-link fallback', () => {
    const vibe = read('app/(app)/vibe.tsx');
    expect(vibe).toContain("label={t('public.vey.back')}");
    expect(vibe).toContain("!router.canGoBack()");
    expect(vibe).toContain("router.replace('/')");
});
