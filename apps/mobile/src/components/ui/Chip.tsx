import { Pressable, View, type ViewProps } from 'react-native';
import { ds } from '../../theme';
import { Text } from './Text';
import { themedStyles, useThemedStyles } from './AppearanceContext';
export function Chip({ label, selected, onPress, style }: { label: string; selected?: boolean; onPress?: () => void; style?: ViewProps['style'] }) {
    const s = useThemedStyles(sheets);
    const content = (
        <Text variant="caption" tone={selected ? 'accent' : 'secondary'}>
            {label}
        </Text>
    );
    return onPress ? (
        <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[s.hit, style]}>
            <View style={[s.chip, selected && s.selected]}>{content}</View>
        </Pressable>
    ) : (
        <View style={[s.chip, selected && s.selected, style]}>{content}</View>
    );
}
const sheets = themedStyles((p) => ({
    hit: { minHeight: 44, justifyContent: 'center' },
    chip: { borderRadius: ds.radius.pill, backgroundColor: p.surface, paddingHorizontal: ds.space.md, paddingVertical: ds.space.sm, alignSelf: 'flex-start' },
    selected: { backgroundColor: p.accentSubtle },
}));
