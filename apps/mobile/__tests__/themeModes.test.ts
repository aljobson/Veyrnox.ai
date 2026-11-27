import { ACCENTS, DEFAULT_APPEARANCE, paletteForScheme, resolveScheme, THEME_PREFERENCES, toggledTheme, tokensForScheme, VIVID_HUES, vividFromFeatureHue, vividHue } from '../src/theme';

const light = {
    background: '#ffffff',
    surface: '#f6f6f7',
    text: '#0a0a0b',
    body: '#52525b',
    muted: '#6b6b73',
    accent: '#0b7a66',
    accentInk: '#ffffff',
    money: '#8a5a00',
    danger: '#c4241a',
};
const lum = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

describe('light and dark', () => {
    test('offers System, Light and Dark', () => {
        expect(THEME_PREFERENCES).toEqual(['system', 'light', 'dark', 'oled']);
        expect(DEFAULT_APPEARANCE.theme).toBe('system');
    });

    test('provides concrete navigation colours for both resolved appearances', () => {
        expect(paletteForScheme('light').background).toBe('#ffffff');
        expect(paletteForScheme('light').text).toBe('#0a0a0b');
        expect(paletteForScheme('dark').background).toBe('#0a0a0b');
        expect(paletteForScheme('dark').text).toBe('#f2f2f3');
    });
    test('an explicit choice wins; System follows the phone and falls back to dark', () => {
        expect(resolveScheme('light', 'dark')).toBe('light');
        expect(resolveScheme('dark', 'light')).toBe('dark');
        expect(resolveScheme('system', 'light')).toBe('light');
        expect(resolveScheme('system', 'dark')).toBe('dark');
        expect(resolveScheme('system', null)).toBe('dark');
    });
    test('the header toggle always changes to the opposite explicit theme', () => {
        expect(toggledTheme('dark')).toBe('light');
        expect(toggledTheme('light')).toBe('dark');
    });
    test('the light palette keeps text readable (WCAG AA, 4.5:1) on both surfaces', () => {
        for (const text of [light.text, light.body, light.muted, light.accent, light.money, light.danger]) {
            expect(ratio(text, light.background)).toBeGreaterThanOrEqual(4.5);
            expect(ratio(text, light.surface)).toBeGreaterThanOrEqual(4.5);
        }
        expect(ratio(light.accentInk, light.accent)).toBeGreaterThanOrEqual(4.5);
    });
    test.each(['light', 'dark'] as const)('every vivid %s card keeps white copy at WCAG AA contrast', scheme => {
        for (const hue of VIVID_HUES) {
            const tone = vividHue(hue, scheme);
            expect(ratio(tone.foreground, tone.fill)).toBeGreaterThanOrEqual(4.5);
            expect(tone.glow).toMatch(/^#/);
            expect(tone.edge).toMatch(/^rgba\(/);
        }
    });
    test('feature hues map to navigation colours without borrowing status semantics', () => {
        expect(['green', 'purple', 'blue', 'pink', 'orange']).toEqual(
            ['mint', 'iris', 'sky', 'rose', 'amber'].map((hue) => vividFromFeatureHue(hue as Parameters<typeof vividFromFeatureHue>[0])),
        );
    });
    test.each(['light', 'dark'] as const)('every %s accent and OLED keep semantic status cues and stronger increased-contrast tokens', scheme => {
        for (const accent of ACCENTS) {
            const settings = { ...DEFAULT_APPEARANCE, accent, theme: scheme === 'dark' ? 'oled' as const : 'light' as const };
            const standard = tokensForScheme(scheme, settings);
            const stronger = tokensForScheme(scheme, settings, true);
            expect(stronger.borderSubtle).not.toBe(standard.borderSubtle);
            expect(ratio(stronger.borderSubtle, stronger.bg)).toBeGreaterThanOrEqual(3);
            expect(ratio(stronger.textSecondary, stronger.bg)).toBeGreaterThanOrEqual(4.5);
            expect(ratio(stronger.textTertiary, stronger.bg)).toBeGreaterThanOrEqual(4.5);
            expect(ratio(stronger.accent, stronger.bg)).toBeGreaterThanOrEqual(3);
            expect(ratio(stronger.onAccent, stronger.accent)).toBeGreaterThanOrEqual(4.5);
            for (const tone of ['success', 'warning', 'notice', 'danger'] as const) {
                expect(stronger[tone]).toMatch(/^#/);
                expect(stronger[`${tone}Subtle`]).toMatch(/^rgba\(/);
            }
            if (scheme === 'dark') expect(stronger.bg).toBe('#000000');
        }
    });
});
