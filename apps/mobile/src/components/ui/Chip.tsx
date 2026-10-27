import { Pressable, View, type PressableProps } from 'react-native';
import { ds } from '../../theme';
import type { ReactNode } from 'react';
import type { MenuIcon } from '../../lib/menuIcons';
import { Icon } from './Icon';
import { Text } from './Text';
import { themedStyles, useThemedStyles } from './AppearanceContext';
export function Chip({ label, selected, onPress, style, fullWidth = false, icon, trailingIcon, children, ...props }: Omit<PressableProps, 'children'> & { label: string; selected?: boolean; fullWidth?: boolean; icon?: MenuIcon; trailingIcon?: MenuIcon; children?: ReactNode }) {
    const s = useThemedStyles(sheets);
    const content = (
        <>
            {icon ? <Icon name={icon} size={20} /> : null}
            {children ?? <Text variant="caption" tone={selected ? 'accent' : 'secondary'}>{label}</Text>}
            {trailingIcon ? <Icon name={trailingIcon} size={16} /> : null}
        </>
    );
    return onPress ? (
        <Pressable {...props} accessibilityRole={props.accessibilityRole ?? "button"} accessibilityLabel={props.accessibilityLabel ?? label} accessibilityState={{ ...props.accessibilityState, ...(selected === undefined || props.accessibilityRole === 'switch' ? {} : { selected }) }} onPress={onPress} style={(state) => [s.hit, props.disabled && s.disabled, typeof style === 'function' ? style(state) : style]}>
            <View style={[s.chip, fullWidth && s.fullWidth, selected && s.selected]}>{content}</View>
        </Pressable>
    ) : (
        <View style={[s.chip, fullWidth && s.fullWidth, selected && s.selected, typeof style === 'function' ? undefined : style]}>{content}</View>
    );
}
const sheets = themedStyles((p) => ({
    hit: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
    chip: { flexDirection: 'row', alignItems: 'center', gap: ds.space.xs, borderRadius: ds.radius.pill, backgroundColor: p.surface, paddingHorizontal: ds.space.md, paddingVertical: ds.space.sm, alignSelf: 'flex-start' },
    disabled: { opacity: 0.4 },
    fullWidth: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
    selected: { backgroundColor: p.accentSubtle },
}));
