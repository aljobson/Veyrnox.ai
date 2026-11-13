import { Pressable, View } from 'react-native';
import { t } from '../../lib/i18n';
import type { MenuIcon } from '../../lib/menuIcons';
import { ds } from '../../theme';
import { Icon, Text } from '../ui';
import { themedStyles, useThemedStyles } from '../ui/AppearanceContext';

export type Tool = 'looks' | 'retouch' | 'makeup' | 'hair' | 'aiWig';
const TOOLS: readonly { id: Tool; icon: MenuIcon }[] = [
    { id: 'looks', icon: 'palette' }, { id: 'retouch', icon: 'sliders' }, { id: 'makeup', icon: 'brush' }, { id: 'hair', icon: 'swatches' }, { id: 'aiWig', icon: 'magicWand' },
];
// The row of round tools under the photo, like Photos: the selected one is filled and its panel opens above.
export function ToolStrip({ value, onChange }: { value: Tool; onChange: (tool: Tool) => void }) {
    const s = useThemedStyles(sheets);
    const names: Record<Tool, string> = { looks: t('liveEdit.tool.looks'), retouch: t('liveEdit.tool.retouch'), makeup: t('liveEdit.tool.makeup'), hair: t('liveEdit.tool.hair'), aiWig: t('liveEdit.tool.aiWig') };
    return (
        <View accessibilityRole="tablist" style={s.row}>
            {TOOLS.map(({ id, icon }) => {
                const on = id === value;
                return (
                    <Pressable key={id} accessibilityRole="tab" accessibilityLabel={names[id]} accessibilityState={{ selected: on }} onPress={() => onChange(id)} style={s.item}>
                        <View style={[s.circle, on && s.circleOn]}><Icon name={icon} size={24} tint={on ? s.iconOn.color : s.iconOff.color} /></View>
                        <Text variant="micro" numberOfLines={1} tone={on ? 'primary' : 'secondary'}>{names[id]}</Text>
                    </Pressable>
                );
            })}
        </View>
    );
}
const sheets = themedStyles(p => ({
    row: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: ds.space.sm },
    item: { flex: 1, minHeight: 44, alignItems: 'center', gap: ds.space.xs },
    circle: { width: 44, height: 44, borderRadius: ds.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
    circleOn: { backgroundColor: p.surface },
    iconOn: { color: p.accent },
    iconOff: { color: p.textSecondary },
}));
