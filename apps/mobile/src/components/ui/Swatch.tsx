import { rawText } from '../../lib/i18n/translate';
import { Pressable, View } from 'react-native';
import { ds, accentPairs, type Accent } from '../../theme';
import { Icon } from './Icon';
import { Text } from './Text';
import { themedStyles, useThemedStyles } from './AppearanceContext';
export function Swatch({ accent, label, selected, onPress }: { accent: Accent; label: string; selected: boolean; onPress: () => void }) {
    const s = useThemedStyles(sheets);
    return (
        <Pressable accessibilityRole="radio" accessibilityLabel={rawText(label)} accessibilityState={{ selected, checked: selected }} onPress={onPress} style={s.hit}>
            <View style={[s.ring, selected && s.selected]}>
                <View style={[s.fill, s[accent]]}>{selected ? <Icon name="check" tint={s[accent].color} size={20} /> : null}</View>
            </View>
            <Text variant="caption">{label}</Text>
        </Pressable>
    );
}
const sheets = themedStyles((p, _, scheme) => ({
    mint: { backgroundColor: accentPairs.mint[scheme][0], color: accentPairs.mint[scheme][1] },
    iris: { backgroundColor: accentPairs.iris[scheme][0], color: accentPairs.iris[scheme][1] },
    sky: { backgroundColor: accentPairs.sky[scheme][0], color: accentPairs.sky[scheme][1] },
    rose: { backgroundColor: accentPairs.rose[scheme][0], color: accentPairs.rose[scheme][1] },
    mono: { backgroundColor: accentPairs.mono[scheme][0], color: accentPairs.mono[scheme][1] },

    hit: { minHeight: 44, alignItems: 'center', gap: ds.space.xs },
    ring: { width: 44, height: 44, borderRadius: ds.radius.pill, borderWidth: 2, borderColor: p.bg, justifyContent: 'center', alignItems: 'center' },
    selected: { borderColor: p.accent },
    fill: { width: 32, height: 32, borderRadius: ds.radius.pill, justifyContent: 'center', alignItems: 'center' },
}));
