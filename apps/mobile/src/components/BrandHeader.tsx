import { View } from 'react-native';
import { Image } from 'expo-image';
import { ds, paletteForScheme } from '../theme';
import { Logo } from './Logo';
import { themedStyles, useAppearance, useThemedStyles } from './ui';

// The compact lockup that carries the splash over to the language screen: a small Vey beside the wordmark. It follows the
// live appearance, so a dark/light switch does not leave a light wordmark on a light background.
export function BrandHeader() {
    const s = useThemedStyles(sheets);
    const { settings, scheme } = useAppearance();
    return (
        <View style={s.row}>
            <Image source={require('../../assets/mascot.png')} style={s.mascot} contentFit="contain" accessible={false} />
            <Logo size={28} palette={paletteForScheme(scheme, settings)} />
        </View>
    );
}

const sheets = themedStyles(() => ({
    row: { flexDirection: 'row', alignItems: 'center', gap: ds.space.md, marginBottom: ds.space.lg },
    mascot: { width: 40, height: 40 },
}));
