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
                        accessibilityLabel={option.accessibilityLabel}
                        accessibilityState={{ selected: value === option.value }}
                        onPress={() => onChange(option.value)}
                        style={[s.item, value === option.value && s.selected]}
                    >
                        {option.icon ? <Icon name={option.icon} size={20} /> : null}
                        <Text variant="callout" style={translated ? { textAlign: 'center' } : undefined} tone={value === option.value ? 'primary' : 'secondary'}>
                            {option.label}
                        </Text>
                    </Pressable>
                ))}
            </View>
        </ControlLabelContext>
    );
}
const sheets = themedStyles((p) => ({
    row: { flexDirection: 'row', padding: ds.space.xs, borderRadius: ds.radius.md, backgroundColor: p.surface, gap: ds.space.xs },
    item: { flex: 1, gap: ds.space.xs, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: ds.radius.sm },
    selected: { backgroundColor: p.bgElevated2 },
}));
