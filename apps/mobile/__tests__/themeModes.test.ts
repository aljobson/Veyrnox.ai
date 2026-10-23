import { resolveScheme, THEME_PREFERENCES, toggledTheme } from '../src/theme';

const light = { background: '#ffffff', surface: '#f6f6f7', text: '#0a0a0b', body: '#3f3f46', muted: '#52525b', accent: '#0b7a66', accentInk: '#ffffff', money: '#8a5a00', danger: '#c4241a' };
const lum = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

describe('light and dark', () => {
    test('offers System, Light and Dark', () => {
        expect(THEME_PREFERENCES).toEqual(['system', 'light', 'dark']);
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
});
