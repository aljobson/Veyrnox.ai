import { rawText } from '../../lib/i18n/translate';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { ds, featureHue, type FeatureHue } from '../../theme';
import type { MenuIcon } from '../../lib/menuIcons';
import { Card } from './Card';
import { Text } from './Text';
import { Icon } from './Icon';
import { themedStyles, useThemedStyles, useAppearance } from './AppearanceContext';
// `hue` gives the card a soft wash of a feature colour and tints its icon, like the Tools tiles (IconBadge).
export function ChoiceCard({ icon, title, detail, selected, hue, onPress }: { icon: MenuIcon; title: string; detail?: string; selected?: boolean; hue?: FeatureHue; onPress: () => void }) {
    const s = useThemedStyles(sheets);
    const { scheme } = useAppearance();
    const colour = hue ? featureHue(hue, scheme) : null;
    const tint = useMemo(() => colour ? { card: { backgroundColor: colour.wash, borderColor: selected ? undefined : colour.edge }, circle: { backgroundColor: colour.wash, borderWidth: 1, borderColor: colour.edge } } : null, [colour?.wash, colour?.edge, selected]);
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={rawText(detail ? `${title}. ${detail}` : title)} accessibilityState={{ selected }} onPress={onPress}>
            <Card selected={selected} style={[s.card, tint?.card]}>
                <View style={s.top}>
                    <View style={[s.circle, tint?.circle]}>
                        <Icon name={icon} tint={colour?.ink} />
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
    card: { borderWidth: 2, gap: ds.space.sm, minHeight: 144 },
    top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    circle: { width: 44, height: 44, borderRadius: ds.radius.pill, backgroundColor: p.surface, alignItems: 'center', justifyContent: 'center' },
    check: { width: 22, height: 22, borderRadius: ds.radius.pill, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    ink: { color: p.onAccent },
}));
