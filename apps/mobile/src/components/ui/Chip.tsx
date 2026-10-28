import { rawText } from '../../lib/i18n/translate';
import { ControlLabelContext } from './ControlLabelContext';
import { getLocale } from '../../lib/i18n';
import { Pressable, View, type PressableProps } from 'react-native';
import { ds } from '../../theme';
import type { ReactNode } from 'react';
import type { MenuIcon } from '../../lib/menuIcons';
import { Icon } from './Icon';
import { Text } from './Text';
import { themedStyles, useThemedStyles } from './AppearanceContext';
export function Chip({ label, selected, onPress, style, fullWidth = false, icon, trailingIcon, children, ...props }: Omit<PressableProps, 'children'> & { label: string; selected?: boolean; fullWidth?: boolean; icon?: MenuIcon; trailingIcon?: MenuIcon; children?: ReactNode }) {
    const s = useThemedStyles(sheets);
    const translated = getLocale() !== 'en';
    const content = (
        <ControlLabelContext value>
            {icon ? <Icon name={icon} size={20} /> : null}
            {children ?? <Text variant="caption" style={translated ? { textAlign: 'center' } : undefined} tone={selected ? 'primary' : 'secondary'}>{label}</Text>}
            {trailingIcon ? <Icon name={trailingIcon} size={16} /> : null}
        </ControlLabelContext>
    );
    return onPress ? (
        <Pressable {...props} accessibilityRole={props.accessibilityRole ?? "button"} accessibilityLabel={rawText(props.accessibilityLabel ?? label)} accessibilityState={{ ...props.accessibilityState, ...(selected === undefined || props.accessibilityRole === 'switch' ? {} : { selected }) }} onPress={onPress} style={(state) => [s.hit, props.disabled && s.disabled, typeof style === 'function' ? style(state) : style]}>
            <View style={[s.chip, translated && { maxWidth: '100%' }, fullWidth && s.fullWidth, selected && s.selected]}>{selected ? <View pointerEvents="none" style={s.outline} /> : null}{content}</View>
        </Pressable>
    ) : (
        <View style={[s.chip, translated && { maxWidth: '100%' }, fullWidth && s.fullWidth, selected && s.selected, typeof style === 'function' ? undefined : style]}>{selected ? <View pointerEvents="none" style={s.outline} /> : null}{content}</View>
    );
}
const sheets = themedStyles((p) => ({
    hit: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
    chip: { flexDirection: 'row', alignItems: 'center', gap: ds.space.xs, borderRadius: ds.radius.pill, backgroundColor: p.surface, paddingHorizontal: ds.space.md, paddingVertical: ds.space.sm, alignSelf: 'flex-start' },
    disabled: { opacity: 0.4 },
    fullWidth: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
    outline: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, borderRadius: ds.radius.pill, borderWidth: 2, borderColor: p.textPrimary },
    selected: { backgroundColor: p.accentSubtle },
}));
