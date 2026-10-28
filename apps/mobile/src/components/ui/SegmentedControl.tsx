import { rawText } from '../../lib/i18n/translate';
import { ControlLabelContext } from './ControlLabelContext';
import { getLocale } from '../../lib/i18n';
import { Pressable, View, type ViewProps } from 'react-native';
import { ds } from '../../theme';
import type { MenuIcon } from '../../lib/menuIcons';
import { Icon } from './Icon';
import { Text } from './Text';
import { themedStyles, useThemedStyles } from './AppearanceContext';
export function SegmentedControl<T extends string>({ options, value, onChange, ...props }: ViewProps & { options: readonly { value: T; label: string; accessibilityLabel?: string; icon?: MenuIcon }[]; value: T; onChange: (next: T) => void }) {
    const s = useThemedStyles(sheets);
    const translated = getLocale() !== 'en';
    return (
        <ControlLabelContext value>
            <View {...props} style={[s.row, props.style]} accessibilityRole="tablist">
                {options.map((option) => (
                    <Pressable
                        key={option.value}
                        accessibilityRole="tab"
                        accessibilityLabel={rawText(option.accessibilityLabel ?? option.label)}
                        accessibilityState={{ selected: value === option.value }}
                        onPress={() => onChange(option.value)}
                        style={[s.item, value === option.value && s.selected]}
                    >
                        {value === option.value ? <View pointerEvents="none" style={s.outline} /> : null}
                        {option.icon ? <Icon name={option.icon} size={20} /> : null}
                        <View style={s.label}>
                            {/* Reserve the bold label's size in both states, including wrapped text. */}
                            <Text variant="callout" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[s.labelMeasure, translated && { textAlign: 'center' }]}>{option.label}</Text>
                            <Text variant="callout" style={[s.labelText, value === option.value && { fontWeight: '700' }]} tone={value === option.value ? 'primary' : 'secondary'}>
                                {option.label}
                            </Text>
                        </View>
                    </Pressable>
                ))}
            </View>
        </ControlLabelContext>
    );
}
const sheets = themedStyles((p) => ({
    row: { flexDirection: 'row', padding: ds.space.xs, borderRadius: ds.radius.md, backgroundColor: p.surface, gap: ds.space.xs },
    item: { flex: 1, gap: ds.space.xs, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: ds.radius.sm },
    outline: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, borderRadius: ds.radius.sm, borderWidth: 2, borderColor: p.textPrimary },
    label: { maxWidth: '100%' },
    labelMeasure: { opacity: 0, fontWeight: '700' },
    labelText: { position: 'absolute', top: 0, left: 0, right: 0, textAlign: 'center' },
    selected: { backgroundColor: p.bgElevated2 },
}));
