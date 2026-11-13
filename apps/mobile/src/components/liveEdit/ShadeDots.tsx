import { Pressable, View } from 'react-native';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';
import { themedStyles, useThemedStyles } from '../ui/AppearanceContext';

// Round colour dots, like the Markup palette in Photos. The colours are the engine's own shade table, so a dot is exactly what gets painted.
export function ShadeDots({ shades, colours, selected, onSelect, disabled, second }: { shades: readonly string[]; colours: Record<string, string>; selected: string | undefined; onSelect: (shade: string) => void; disabled: boolean; second?: boolean }) {
    const s = useThemedStyles(sheets);
    return (
        <View accessibilityRole="radiogroup" style={s.row}>
            {shades.map((shade, index) => {
                const on = shade === selected;
                return (
                    <Pressable key={shade} accessibilityRole="radio" accessibilityLabel={t(second ? 'liveEdit.secondShade' : 'liveEdit.shade', { n: String(index + 1) })} accessibilityState={{ selected: on, checked: on, disabled }} disabled={disabled} onPress={() => onSelect(shade)} style={[s.hit, disabled && s.off]}>
                        <View style={[s.ring, on && s.ringOn]}><View style={[s.dot, { backgroundColor: colours[shade] }]} /></View>
                    </Pressable>
                );
            })}
        </View>
    );
}
const sheets = themedStyles(p => ({
    row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: ds.space.xs },
    hit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    off: { opacity: 0.4 },
    ring: { width: 36, height: 36, borderRadius: ds.radius.pill, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
    ringOn: { borderColor: p.textPrimary },
    dot: { width: 26, height: 26, borderRadius: ds.radius.pill, borderWidth: 1, borderColor: p.borderSubtle },
}));
