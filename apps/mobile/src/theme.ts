declare const require: (id: string) => any;
// Loaded lazily and guarded: a test that stubs react-native or runs without the native modules just gets the dark default.
const secureStore = (): { getItem(k: string): string | null; setItem(k: string, v: string): void } | null => {
    try { return require('expo-secure-store'); } catch { return null; }
};
const appearance = (): { getColorScheme(): string | null | undefined; setColorScheme(s: 'light' | 'dark' | null): void } | null => {
    try { return require('react-native').Appearance ?? null; } catch { return null; }
};

// The Veyrnox.ai palettes: the --vx-* tokens in app/globals.css (dark by default, and the light set under data-theme='light'), as hex.
const DARK = {
    background: '#0a0a0b',
    surface: '#141416',
    border: '#26262a',
    borderStrong: '#3e3e44',
    text: '#f2f2f3',
    body: '#c9c9cf',
    muted: '#9a9aa3',
    accent: '#3ee6c4',
    accentInk: '#06231f',
    accentSoft: 'rgba(62, 230, 196, 0.14)',
    money: '#e4a93c',
    danger: '#ff5c47',
};
const LIGHT: Palette = {
    background: '#ffffff',
    surface: '#f6f6f7',
    border: '#dcdce0',
    borderStrong: '#a8a8b0',
    text: '#0a0a0b',
    body: '#3f3f46',
    muted: '#52525b',
    accent: '#0b7a66',
    accentInk: '#ffffff',
    accentSoft: 'rgba(11, 122, 102, 0.12)',
    money: '#8a5a00',
    danger: '#c4241a',
};
export type Palette = { readonly [K in keyof typeof DARK]: string };

export type ThemePreference = 'system' | 'light' | 'dark';
const THEME_KEY = 'veyrnox.theme';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

// Read synchronously, once, when the app starts: the screens build their styles from `colors` as they load, so the choice
// applies the next time the app opens. SecureStore is the app's existing small store; a failed read means System.
export function readThemePreference(): ThemePreference {
    try {
        const v = secureStore()?.getItem(THEME_KEY);
        return v === 'light' || v === 'dark' ? v : 'system';
    } catch {
        return 'system';
    }
}
export function saveThemePreference(preference: ThemePreference): void {
    try {
        secureStore()?.setItem(THEME_KEY, preference);
    } catch {
        // The choice just does not stick; the app keeps its current look.
    }
}
// System follows the phone; when the phone does not say, the app keeps its original dark look.
export const resolveScheme = (preference: ThemePreference, system: string | null | undefined): 'light' | 'dark' =>
    preference === 'light' || preference === 'dark' ? preference : system === 'light' ? 'light' : 'dark';

const safeSystemScheme = (): string | null | undefined => {
    try { return appearance()?.getColorScheme(); } catch { return null; }
};
export const themePreference = readThemePreference();
export const scheme = resolveScheme(themePreference, safeSystemScheme());
export const isDark = scheme === 'dark';
// Keyboards, alerts and sheets follow an explicit choice too.
if (themePreference !== 'system') {
    try {
        appearance()?.setColorScheme(themePreference);
    } catch {
        // Older native builds fix the style in Info.plist; our own screens still follow the choice.
    }
}

export const colors: Palette = isDark ? DARK : LIGHT;

// Shared sizes, so screens stop repeating literals. Values match what the screens already used.
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 6, md: 10, lg: 12, pill: 999 } as const;
export const type = {
    caption: { fontSize: 12 },
    small: { fontSize: 13 },
    footnote: { fontSize: 14 },
    callout: { fontSize: 15 },
    body: { fontSize: 16 },
    titleLarge: { fontSize: 32, fontWeight: '700' },
    label: { fontSize: 16, fontWeight: '600' },
} as const;
export const disabledOpacity = 0.4;
