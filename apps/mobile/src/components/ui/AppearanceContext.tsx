import { createContext, useContext, useSyncExternalStore } from 'react';
import { AccessibilityInfo, StyleSheet, useColorScheme, useWindowDimensions } from 'react-native';
import { getAppearance, subscribeAppearance, resolveScheme, tokensForScheme, rampFor, type AppearanceSettings, type Tokens, type Scheme } from '../../theme';
export const AppearanceContext = createContext<AppearanceSettings | null>(null);
let increasedContrast = false;
let contrastStarted = false;
let contrastSubscription: { remove(): void } | undefined;
const contrastListeners = new Set<() => void>();
const publishContrast = (next: boolean) => {
    if (increasedContrast === next) return;
    increasedContrast = next;
    contrastListeners.forEach(listener => listener());
};
const subscribeContrast = (listener: () => void) => {
    contrastListeners.add(listener);
    if (!contrastStarted) {
        contrastStarted = true;
        AccessibilityInfo.isDarkerSystemColorsEnabled?.().then(publishContrast).catch(() => undefined);
        contrastSubscription = AccessibilityInfo.addEventListener?.('darkerSystemColorsChanged', publishContrast);
    }
    return () => {
        contrastListeners.delete(listener);
        if (contrastListeners.size === 0) {
            contrastSubscription?.remove();
            contrastSubscription = undefined;
            contrastStarted = false;
        }
    };
};
function useIncreasedContrast() {
    return useSyncExternalStore(subscribeContrast, () => increasedContrast, () => false);
}
export function useAppearance() {
    const saved = useSyncExternalStore(subscribeAppearance, getAppearance, getAppearance);
    const pending = useContext(AppearanceContext);
    const system = useColorScheme();
    const settings = pending ?? saved;
    const increasedContrast = useIncreasedContrast();
    return { settings, scheme: resolveScheme(settings.theme, system), increasedContrast };
}
const key = (s: AppearanceSettings, scheme: Scheme, increasedContrast: boolean) => `${s.theme === 'oled' ? 'oled' : scheme}/${s.accent}/${s.typeface}/${s.textSize}/${increasedContrast ? 'high' : 'standard'}`;
// Factories live at module scope; each settings key is built once, when first requested.
// Derive this from the installed API: Expo enables RN generated types, which differ from its legacy interfaces.
type NamedStyles = Parameters<typeof StyleSheet.create>[0];
export function themedStyles<const T extends NamedStyles>(make: (p: Tokens, ramp: ReturnType<typeof rampFor>, scheme: Scheme) => T) {
    const sheets = new Map<string, T>();
    return (settings: AppearanceSettings, scheme: Scheme, increasedContrast = false): T => {
        const cacheKey = key(settings, scheme, increasedContrast);
        const cached = sheets.get(cacheKey);
        if (cached) return cached;
        const styles = make(tokensForScheme(scheme, settings, increasedContrast), rampFor(settings), scheme);
        const sheet = StyleSheet.create<T>(styles);
        sheets.set(cacheKey, sheet);
        return sheet;
    };
}
export function useThemedStyles<T>(sheets: (s: AppearanceSettings, scheme: Scheme, increasedContrast?: boolean) => T): T {
    // Native Text scales itself; subscribing here also rerenders mounted lists/layouts.
    // Do not multiply the ramp by fontScale (that would scale native text twice).
    useWindowDimensions();
    const { settings, scheme, increasedContrast } = useAppearance();
    return sheets(settings, scheme, increasedContrast);
}
