import { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import type { FeatureIcon } from '../../lib/featureIcons';
import { featureHue } from '../../theme';
import { useAppearance } from './AppearanceContext';
import { Icon } from './Icon';

// A rounded tile holding one icon in its feature colour, on a soft wash of the same colour.
export function IconBadge({ icon, hue, size = 'md' }: FeatureIcon & { readonly size?: 'md' | 'lg' }) {
    const { scheme } = useAppearance();
    const colour = featureHue(hue, scheme);
    const tile = useMemo(() => ({ backgroundColor: colour.wash, borderColor: colour.edge }), [colour.wash, colour.edge]);
    return (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.tile, size === 'lg' ? styles.lg : styles.md, tile]}>
            <Icon name={icon} size={size === 'lg' ? 28 : 24} tint={colour.ink} />
        </View>
    );
}

const styles = StyleSheet.create({
    tile: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
    md: { width: 44, height: 44, borderRadius: 12 },
    lg: { width: 52, height: 52, borderRadius: 14 },
});
