import { useMemo } from 'react';
import { Image, View, StyleSheet } from 'react-native';
import type { FeatureIcon } from '../../lib/featureIcons';
import { ds, vividFromFeatureHue, vividHue } from '../../theme';
import { useAppearance } from './AppearanceContext';
import { Icon } from './Icon';

// A rounded tile holding one white icon on the same vivid palette used by navigation cards.
export function IconBadge({ icon, hue, art, size = 'md' }: FeatureIcon & { readonly size?: 'sm' | 'md' | 'lg' | 'xl' }) {
    const { scheme } = useAppearance();
    const colour = vividHue(vividFromFeatureHue(hue), scheme);
    const tile = useMemo(() => ({ backgroundColor: colour.fill, borderColor: colour.edge }), [colour.fill, colour.edge]);
    return (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.tile, styles[size], tile]}>
            {art ? <Image testID="icon-art" source={art} style={artSizes[size]} />
                : <Icon name={icon} size={size === 'sm' ? 20 : size === 'md' ? 24 : 28} tint={colour.foreground} />}
        </View>
    );
}

const styles = StyleSheet.create({
    tile: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
    sm: { width: 32, height: 32, borderRadius: ds.radius.sm },
    xl: { width: 64, height: 64, borderRadius: ds.radius.lg },
    md: { width: 44, height: 44, borderRadius: ds.radius.md },
    lg: { width: 52, height: 52, borderRadius: ds.radius.md },
});
const artSizes = StyleSheet.create({ sm: { width: 26, height: 26 }, md: { width: 32, height: 32 }, lg: { width: 38, height: 38 }, xl: { width: 48, height: 48 } });
