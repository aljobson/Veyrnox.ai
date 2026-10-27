import { View, Pressable, StyleSheet, type ViewProps, type PressableProps } from 'react-native';
import { ds } from '../../theme';
import { themedStyles, useThemedStyles } from './AppearanceContext';
export function Card({ style, selected, onPress, disabled, ...props }: ViewProps & { selected?: boolean; onPress?: PressableProps['onPress']; disabled?: boolean }) {
    const s = useThemedStyles(sheets);
    if (onPress) return <Pressable {...props} accessibilityRole={props.accessibilityRole ?? 'button'} disabled={disabled} onPress={onPress} style={[s.card, s.hit, selected && s.selected, style]} />;
    return <View {...props} style={[s.card, selected && s.selected, style]} />;
}
const sheets = themedStyles((p, _, scheme) => ({
    hit: { minHeight: 44 },
    card: {
        backgroundColor: p.bgElevated1,
        borderRadius: ds.radius.lg,
        padding: ds.space.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: p.borderSubtle,
        boxShadow: ds.elevation[scheme].e1,
    },
    selected: { borderWidth: 2, borderColor: p.accent, backgroundColor: p.accentSubtle },
}));
