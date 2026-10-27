import { Pressable, View } from 'react-native';
import { ds } from '../../theme';
import type { MenuIcon } from '../../lib/menuIcons';
import { Card } from './Card';
import { Text } from './Text';
import { Icon } from './Icon';
import { themedStyles, useThemedStyles } from './AppearanceContext';
export function ChoiceCard({ icon, title, detail, selected, onPress }: { icon: MenuIcon; title: string; detail?: string; selected?: boolean; onPress: () => void }) {
    const s = useThemedStyles(sheets);
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={detail ? `${title}. ${detail}` : title} accessibilityState={{ selected }} onPress={onPress}>
            <Card selected={selected} style={s.card}>
                <View style={s.top}>
                    <View style={s.circle}>
                        <Icon name={icon} />
                    </View>
                    {selected ? (
                        <View style={s.check}>
                            <Icon name="check" size={16} tint={s.ink.color} />
                        </View>
                    ) : null}
                </View>
                <Text variant="title3">{title}</Text>
                {detail ? (
                    <Text variant="footnote" tone="secondary">
                        {detail}
                    </Text>
                ) : null}
            </Card>
        </Pressable>
    );
}
const sheets = themedStyles((p) => ({
    card: { gap: ds.space.sm, minHeight: 144 },
    top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    circle: { width: 44, height: 44, borderRadius: ds.radius.pill, backgroundColor: p.surface, alignItems: 'center', justifyContent: 'center' },
    check: { width: 22, height: 22, borderRadius: ds.radius.pill, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    ink: { color: p.onAccent },
}));
