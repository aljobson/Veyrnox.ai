import { createContext, useContext, useSyncExternalStore } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { getAppearance, subscribeAppearance, resolveScheme, tokensForScheme, rampFor, type AppearanceSettings, type Tokens, type Scheme } from '../../theme';
export const AppearanceContext = createContext<AppearanceSettings | null>(null);
export function useAppearance() {
    const saved = useSyncExternalStore(subscribeAppearance, getAppearance, getAppearance);
    const pending = useContext(AppearanceContext);
    const system = useColorScheme();
    const settings = pending ?? saved;
    return { settings, scheme: resolveScheme(settings.theme, system) };
}
const key = (s: AppearanceSettings, scheme: Scheme) => `${s.theme === 'oled' ? 'oled' : scheme}/${s.accent}/${s.typeface}/${s.textSize}`;
// Factories live at module scope; each settings key is built once, when first requested.
// Derive this from the installed API: Expo enables RN generated types, which differ from its legacy interfaces.
type NamedStyles = Parameters<typeof StyleSheet.create>[0];
export function themedStyles<const T extends NamedStyles>(make: (p: Tokens, ramp: ReturnType<typeof rampFor>, scheme: Scheme) => T) {
    const sheets = new Map<string, T>();
    return (settings: AppearanceSettings, scheme: Scheme): T => {
        const cacheKey = key(settings, scheme);
        const cached = sheets.get(cacheKey);
        if (cached) return cached;
        const styles = make(tokensForScheme(scheme, settings), rampFor(settings), scheme);
        const sheet = StyleSheet.create<T>(styles);
        sheets.set(cacheKey, sheet);
        return sheet;
    };
}
export function useThemedStyles<T>(sheets: (s: AppearanceSettings, scheme: Scheme) => T): T {
    const { settings, scheme } = useAppearance();
    return sheets(settings, scheme);
}
