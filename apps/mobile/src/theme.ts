import { captureEvent } from './lib/analytics/events';
import type { TextStyle } from 'react-native';
declare const require: (id: string) => any;
const secureStore = (): typeof import('expo-secure-store') | null => {
    try {
        return require('expo-secure-store');
    } catch {
        return null;
    }
};
const native = (): typeof import('react-native') | null => {
    try {
        return require('react-native');
    } catch {
        return null;
    }
};
const platform = () => native()?.Platform?.OS ?? 'unknown';
const read = (key: string): string | null => {
    try {
        return secureStore()?.getItem(key) ?? null;
    } catch {
        return null;
    }
};
const save = (key: string, value: string) => {
    try {
        secureStore()?.setItem(key, value);
    } catch {
        /* Next launch uses the last saved choice. */
    }
};
export const THEME_PREFERENCES = ['system', 'light', 'dark', 'oled'] as const;
export const ACCENTS = ['mint', 'iris', 'sky', 'rose', 'mono'] as const;
export const TYPEFACES = ['studio', 'editorial', 'technical'] as const;
export const TEXT_SIZES = ['s', 'm', 'l', 'xl'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type Accent = (typeof ACCENTS)[number];
export type Typeface = (typeof TYPEFACES)[number];
export type TextSize = (typeof TEXT_SIZES)[number];
export type Scheme = 'light' | 'dark';
export type AppearanceSettings = { theme: ThemePreference; accent: Accent; typeface: Typeface; textSize: TextSize };
export const DEFAULT_APPEARANCE: AppearanceSettings = { theme: 'system', accent: 'mint', typeface: 'studio', textSize: 'm' };
const parse = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options.includes(value as T) ? (value as T) : fallback);
export const parseThemePreference = (v: unknown) => parse(v, THEME_PREFERENCES, 'system');
export const parseAccent = (v: unknown) => parse(v, ACCENTS, 'mint');
export const parseTypeface = (v: unknown) => parse(v, TYPEFACES, 'studio');
export const parseTextSize = (v: unknown) => parse(v, TEXT_SIZES, 'm');
export const readThemePreference = (): ThemePreference => parseThemePreference(read('veyrnox.theme'));
export const saveThemePreference = (value: ThemePreference) => save('veyrnox.theme', value);
export function readAppearance(): AppearanceSettings {
    return {
        theme: readThemePreference(),
        accent: parseAccent(read('veyrnox.accent')),
        typeface: parseTypeface(read('veyrnox.typeface')),
        textSize: parseTextSize(read('veyrnox.textSize')),
    };
}
let current = readAppearance();
const listeners = new Set<() => void>();
export const subscribeAppearance = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
export const getAppearance = () => current;
export const getThemePreference = () => current.theme;
export const resolveScheme = (preference: ThemePreference, system: string | null | undefined): Scheme =>
    preference === 'oled' || preference === 'dark' ? 'dark' : preference === 'light' ? 'light' : system === 'light' ? 'light' : 'dark';
export const toggledTheme = (value: Scheme): ThemePreference => (value === 'dark' ? 'light' : 'dark');
export const THEME_RETURN_KEY = 'veyrnox.theme.return';
export async function saveThemeReturnPath(path: string | null): Promise<boolean> {
    try {
        const store = secureStore();
        if (!store || (path !== null && !path.startsWith('/'))) return false;
        if (path === null) await store.deleteItemAsync(THEME_RETURN_KEY);
        else store.setItem(THEME_RETURN_KEY, path);
        return true;
    } catch { return false; }
}
export async function takeThemeReturnPath(): Promise<string | null> {
    try {
        const path = read(THEME_RETURN_KEY);
        if (path) await secureStore()?.deleteItemAsync(THEME_RETURN_KEY);
        return path?.startsWith('/') ? path : null;
    } catch {
        return null;
    }
}
export function needsReload(prev: AppearanceSettings, next: AppearanceSettings, platform: string): boolean {
    if (Object.keys(prev).every((key) => prev[key as keyof AppearanceSettings] === next[key as keyof AppearanceSettings])) return false;
    return (
        platform !== 'ios' ||
        prev.accent !== next.accent ||
        prev.typeface !== next.typeface ||
        prev.textSize !== next.textSize ||
        (prev.theme === 'oled') !== (next.theme === 'oled')
    );
}
export async function applyAppearance(partial: Partial<AppearanceSettings>, returnPath?: string): Promise<void> {
    const next = { ...current, ...partial };
    let reload = needsReload(current, next, 'ios');
    if (platform() !== 'ios') reload = needsReload(current, next, platform());
    for (const key of Object.keys(next) as (keyof AppearanceSettings)[]) save(`veyrnox.${key}`, next[key]);
    current = next;
    captureEvent('appearance_changed', { theme: next.theme, accent: next.accent });
    try {
        native()?.Appearance?.setColorScheme(next.theme === 'system' ? 'unspecified' : resolveScheme(next.theme, null));
    } catch {
        /* Native chrome may be unavailable. */
    }
    listeners.forEach((fn) => fn());
    if (reload) {
        if (returnPath?.startsWith('/') && !(await saveThemeReturnPath(returnPath))) return;
        try {
            await require('expo').reloadAppAsync('Veyrnox appearance changed');
        } catch {
            /* Persisted choice applies on next start. */
        }
    }
}
export const applyThemePreference = (theme: ThemePreference, returnPath?: string) => applyAppearance({ theme }, returnPath);
export const themePreference = current.theme;
export const scheme = resolveScheme(themePreference, native()?.Appearance?.getColorScheme());
export const isDark = scheme === 'dark';
if (themePreference !== 'system') {
    try {
        native()?.Appearance?.setColorScheme(scheme);
    } catch {
        /* Native chrome fallback. */
    }
}

const dark = {
    bg: '#0a0a0b',
    bgElevated1: '#141416',
    bgElevated2: '#1c1c1f',
    surface: '#202024',
    surfacePressed: '#2a2a2f',
    borderSubtle: '#26262a',
    borderStrong: '#777780',
    textPrimary: '#f2f2f3',
    textSecondary: '#a1a1aa',
    textTertiary: '#8b8b94',
    success: '#4ade80',
    warning: '#e4a93c',
    danger: '#ff5c47',
    scrim: 'rgba(0,0,0,0.56)',
    onMedia: '#ffffff',
    mediaShade: 'rgba(0,0,0,0.72)',
};
const light: typeof dark = {
    bg: '#ffffff',
    bgElevated1: '#f6f6f7',
    bgElevated2: '#ffffff',
    surface: '#f0f0f2',
    surfacePressed: '#e6e6ea',
    borderSubtle: '#e4e4e7',
    borderStrong: '#81818a',
    textPrimary: '#0a0a0b',
    textSecondary: '#52525b',
    textTertiary: '#6b6b73',
    success: '#15803d',
    warning: '#8a5a00',
    danger: '#c4241a',
    scrim: 'rgba(10,10,11,0.40)',
    onMedia: '#ffffff',
    mediaShade: 'rgba(0,0,0,0.72)',
};
export const accentPairs = {
    mint: { dark: ['#3ee6c4', '#06231f', '#32b89d'], light: ['#0b7a66', '#ffffff', '#096252'] },
    iris: { dark: ['#a99cff', '#140b3d', '#877dcc'], light: ['#5a46d6', '#ffffff', '#4838ab'] },
    sky: { dark: ['#6cb4ff', '#03203f', '#5690cc'], light: ['#1d5fc9', '#ffffff', '#174ca1'] },
    rose: { dark: ['#ff86b8', '#3a0619', '#cc6b93'], light: ['#b8235f', '#ffffff', '#931c4c'] },
    mono: { dark: ['#f2f2f3', '#0a0a0b', '#c2c2c2'], light: ['#0a0a0b', '#ffffff', '#080809'] },
} as const;
function alpha(hex: string, opacity: number) {
    return `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${opacity})`;
}
export function tokensForScheme(value: Scheme, settings: AppearanceSettings = current) {
    const [accent, onAccent, accentPressed] = accentPairs[settings.accent][value];
    return {
        ...(value === 'light' ? light : dark),
        ...(settings.theme === 'oled' && value === 'dark' ? { bg: '#000000', bgElevated1: '#0e0e10', bgElevated2: '#17171a', surface: '#1c1c1f', borderSubtle: '#222226' } : {}),
        accent,
        onAccent,
        accentPressed,
        accentSubtle: alpha(accent, value === 'dark' ? 0.14 : 0.1),
        iris: accentPairs.iris[value][0],
        rose: accentPairs.rose[value][0],
    };
}
export type Tokens = ReturnType<typeof tokensForScheme>;
export type Palette = {
    readonly [K in 'background' | 'surface' | 'border' | 'borderStrong' | 'text' | 'body' | 'muted' | 'accent' | 'accentInk' | 'accentSoft' | 'money' | 'danger']: string;
};
export function paletteForScheme(value: Scheme, settings: AppearanceSettings = current): Palette {
    const p = tokensForScheme(value, settings);
    return {
        background: p.bg,
        surface: p.bgElevated1,
        border: p.borderSubtle,
        borderStrong: p.borderStrong,
        text: p.textPrimary,
        body: p.textSecondary,
        muted: p.textTertiary,
        accent: p.accent,
        accentInk: p.onAccent,
        accentSoft: p.accentSubtle,
        money: p.warning,
        danger: p.danger,
    };
}
export const studioColors: Palette = paletteForScheme('dark', { ...current, theme: 'dark' });
const dynamicColor = (l: string, d: string): string => {
    const rn = native();
    return rn?.Platform?.OS === 'ios' && rn.DynamicColorIOS ? (rn.DynamicColorIOS({ light: l, dark: d }) as unknown as string) : scheme === 'light' ? l : d;
};
const lightPalette = paletteForScheme('light'),
    darkPalette = paletteForScheme('dark');
export const colors = Object.fromEntries(Object.keys(darkPalette).map((k) => [k, dynamicColor(lightPalette[k as keyof Palette], darkPalette[k as keyof Palette])])) as Palette;
export const brandColors = {
    google: { light: { fill: '#ffffff', border: '#747775', text: '#1f1f1f' }, dark: { fill: '#131314', border: '#8e918f', text: '#e3e3e3' } },
    apple: { light: { fill: '#000000', text: '#ffffff' }, dark: { fill: '#ffffff', text: '#000000' } },
};
export const ds = {
    space: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 40, hero: 56, gutter: 20 },
    radius: { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, pill: 999 },
    elevation: { light: { e1: '0 1px 2px rgba(0,0,0,.06)', e2: '0 4px 12px rgba(0,0,0,.08), 0 1px 3px rgba(0,0,0,.06)' }, dark: { e1: 'none', e2: 'none' } },
    motion: { press: 120, state: 200, enter: 280, sheet: 360, pressScale: 0.98 },
} as const;
export const TEXT_SCALE = { s: 0.9, m: 1, l: 1.12, xl: 1.25 } as const;
export const RAMP = {
    display: [34, 40, -0.6, '700', true],
    title1: [28, 34, -0.4, '700', true],
    title2: [22, 28, -0.2, '600', true],
    title3: [18, 24, -0.1, '600', false],
    body: [16, 22, 0, '400', false],
    bodyStrong: [16, 22, 0, '600', false],
    callout: [15, 20, 0, '400', false],
    footnote: [13, 18, 0, '400', false],
    caption: [12, 16, 0.1, '500', false],
    micro: [11, 14, 0.2, '600', false],
} as const;
export type TextVariant = keyof typeof RAMP;
export function rampFor(settings: AppearanceSettings): Record<TextVariant, TextStyle> {
    return Object.fromEntries(
        Object.entries(RAMP).map(([key, [size, height, tracking, weight, display]]) => {
            let fontFamily: string | undefined;
            let fontWeight: TextStyle['fontWeight'] = weight;
            if (display) {
                if (settings.typeface === 'editorial') {
                    fontFamily = 'InstrumentSerif_400Regular';
                    fontWeight = '400';
                } else if (settings.typeface === 'technical') {
                    fontFamily = weight === '600' ? 'SpaceGrotesk_500Medium' : 'SpaceGrotesk_700Bold';
                    fontWeight = weight === '600' ? '500' : '700';
                } else {
                    fontFamily = 'Archivo_700Bold';
                    fontWeight = '700';
                }
            } else if (settings.typeface !== 'studio') fontFamily = weight === '600' ? 'Inter_600SemiBold' : weight === '500' ? 'Inter_500Medium' : 'Inter_400Regular';
            return [key, { fontSize: size * TEXT_SCALE[settings.textSize], lineHeight: height * TEXT_SCALE[settings.textSize], letterSpacing: tracking, fontFamily, fontWeight }];
        }),
    ) as Record<TextVariant, TextStyle>;
}
export const text = rampFor(current);

// Shared sizes, so screens stop repeating literals. Values match what the screens already used.
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
// Bottom padding at the end of a scrolling list or screen, so its last row clears the tab bar edge comfortably.
export const LIST_END_PADDING = 32;
export const radius = { sm: 6, md: 10, lg: 12, pill: 999 } as const;
export const type = {
    caption: { fontSize: 12 },
    small: { fontSize: 13 },
    footnote: { fontSize: 14 },
    callout: { fontSize: 15 },
    body: { fontSize: 16 },
    titleLarge: { fontFamily: 'Archivo_700Bold', fontSize: 32 },
    label: { fontSize: 16, fontWeight: '600' },
} as const;
// Archivo (the site's display face), loaded in the root layout; headings only, body text stays on the system font.
export const fonts = { display: 'Archivo_700Bold', displayHeavy: 'Archivo_800ExtraBold' } as const;
export const disabledOpacity = 0.4;
