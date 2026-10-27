import { Pressable, View, type PressableProps } from 'react-native';
import { ds } from '../../theme';
import { Text } from './Text';
import { themedStyles, useThemedStyles } from './AppearanceContext';
export function Chip({ label, selected, onPress, style, fullWidth = false, ...props }: Omit<PressableProps, 'children'> & { label: string; selected?: boolean; fullWidth?: boolean }) {
    const s = useThemedStyles(sheets);
    const content = (
        <Text variant="caption" tone={selected ? 'accent' : 'secondary'}>
            {label}
        </Text>
    );
    return onPress ? (
        <Pressable {...props} accessibilityRole={props.accessibilityRole ?? "button"} accessibilityLabel={props.accessibilityLabel ?? label} accessibilityState={{ ...props.accessibilityState, selected }} onPress={onPress} style={(state) => [s.hit, typeof style === 'function' ? style(state) : style]}>
            <View style={[s.chip, fullWidth && s.fullWidth, selected && s.selected]}>{content}</View>
        </Pressable>
    ) : (
        <View style={[s.chip, fullWidth && s.fullWidth, selected && s.selected, typeof style === 'function' ? undefined : style]}>{content}</View>
    );
}
const sheets = themedStyles((p) => ({
    hit: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
    chip: { borderRadius: ds.radius.pill, backgroundColor: p.surface, paddingHorizontal: ds.space.md, paddingVertical: ds.space.sm, alignSelf: 'flex-start' },
    fullWidth: { alignSelf: 'stretch', alignItems: 'center' },
    selected: { backgroundColor: p.accentSubtle },
}));
