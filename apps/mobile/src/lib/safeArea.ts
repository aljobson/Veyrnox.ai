import { createContext, useContext } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

export const ZERO_SAFE_AREA_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const FallbackSafeAreaInsetsContext = createContext(ZERO_SAFE_AREA_INSETS);

/** Real provider insets in the app, with a zero fallback for isolated component hosts and tests. */
export function useOptionalSafeAreaInsets() {
    return useContext(SafeAreaInsetsContext ?? FallbackSafeAreaInsetsContext) ?? ZERO_SAFE_AREA_INSETS;
}
