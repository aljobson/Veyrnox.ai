import { Pressable, View, type PressableProps } from 'react-native';
import { ds } from '../../theme';
import { Icon } from './Icon';
import { themedStyles, useThemedStyles } from './AppearanceContext';
export function Checkbox({
    checked,
    onChange,
    children,
    style,
    ...props
}: Omit<PressableProps, 'onPress' | 'children'> & { checked: boolean; onChange: (checked: boolean) => void; children?: React.ReactNode }) {
    const s = useThemedStyles(sheets);
    return (
        <Pressable {...props} accessibilityRole="checkbox" accessibilityState={{ ...props.accessibilityState, checked }} onPress={() => onChange(!checked)} style={(state) => [s.row, typeof style === 'function' ? style(state) : style]}>
            <View style={[s.box, checked && s.checked]}>{checked ? <Icon name="check" size={16} tint={s.ink.color} /> : null}</View>
            <View style={s.copy}>{children}</View>
        </Pressable>
    );
}
const sheets = themedStyles((p) => ({
    row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: ds.space.md },
    copy: { flex: 1 },
    box: { width: 22, height: 22, borderRadius: ds.radius.xs, borderWidth: 1, borderColor: p.borderStrong, justifyContent: 'center', alignItems: 'center' },
    checked: { backgroundColor: p.accent, borderColor: p.accent },
    ink: { color: p.onAccent },
}));
