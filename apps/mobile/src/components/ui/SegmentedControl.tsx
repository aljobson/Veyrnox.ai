import { Pressable, View } from 'react-native';
import { ds } from '../../theme';
import { Text } from './Text';
import { themedStyles, useThemedStyles } from './AppearanceContext';
export function SegmentedControl<T extends string>({ options, value, onChange }: { options: readonly { value: T; label: string }[]; value: T; onChange: (next: T) => void }) {
    const s = useThemedStyles(sheets);
    return (
        <View style={s.row} accessibilityRole="tablist">
            {options.map((option) => (
                <Pressable
                    key={option.value}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: value === option.value }}
                    onPress={() => onChange(option.value)}
                    style={[s.item, value === option.value && s.selected]}
                >
                    <Text variant="callout" tone={value === option.value ? 'primary' : 'secondary'}>
                        {option.label}
                    </Text>
                </Pressable>
            ))}
        </View>
    );
}
const sheets = themedStyles((p) => ({
    row: { flexDirection: 'row', padding: ds.space.xs, borderRadius: ds.radius.md, backgroundColor: p.surface, gap: ds.space.xs },
    item: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: ds.radius.sm },
    selected: { backgroundColor: p.bgElevated2 },
}));
