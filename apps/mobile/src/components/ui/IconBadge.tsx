import { useMemo } from 'react';
import { Image, View, StyleSheet } from 'react-native';
import type { FeatureIcon } from '../../lib/featureIcons';
import { featureHue } from '../../theme';
import { useAppearance } from './AppearanceContext';
import { Icon } from './Icon';

// A rounded tile holding one icon in its feature colour, on a soft wash of the same colour.
export function IconBadge({ icon, hue, art, size = 'md' }: FeatureIcon & { readonly size?: 'sm' | 'md' | 'lg' | 'xl' }) {
    const { scheme } = useAppearance();
    const colour = featureHue(hue, scheme);
    const tile = useMemo(() => ({ backgroundColor: colour.wash, borderColor: colour.edge }), [colour.wash, colour.edge]);
    return (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.tile, styles[size], tile]}>
            {art ? <Image testID="icon-art" source={art} style={artSizes[size]} />
                : <Icon name={icon} size={size === 'sm' ? 20 : size === 'md' ? 24 : 28} tint={colour.ink} />}
        </View>
    );
}

const styles = StyleSheet.create({
    tile: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
    sm: { width: 32, height: 32, borderRadius: 9 },
    xl: { width: 64, height: 64, borderRadius: 18 },
    md: { width: 44, height: 44, borderRadius: 12 },
    lg: { width: 52, height: 52, borderRadius: 14 },
});
const artSizes = StyleSheet.create({ sm: { width: 26, height: 26 }, md: { width: 32, height: 32 }, lg: { width: 38, height: 38 }, xl: { width: 48, height: 48 } });
