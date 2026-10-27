import { useMemo } from 'react';
import { Image, StyleSheet, type ColorValue } from 'react-native';
import { MENU_ICONS, type MenuIcon } from '../../lib/menuIcons';
import { tokensForScheme } from '../../theme';
import { useAppearance } from './AppearanceContext';
export function Icon({ name, size = 24, tint }: { name: MenuIcon; size?: 16 | 20 | 24 | 28; tint?: ColorValue }) {
    const { settings, scheme } = useAppearance();
    const color = tint ?? tokensForScheme(scheme, settings).textSecondary;
    const ink = useMemo(() => ({ tintColor: color }), [color]);
    return <Image source={MENU_ICONS[name]} accessibilityElementsHidden importantForAccessibility="no" style={[sizes[size], name === 'googleG' ? undefined : ink]} />;
}
const sizes = StyleSheet.create({ 16: { width: 16, height: 16 }, 20: { width: 20, height: 20 }, 24: { width: 24, height: 24 }, 28: { width: 28, height: 28 } });
