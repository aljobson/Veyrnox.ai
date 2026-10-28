import { rawText } from '../../lib/i18n/translate';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { displayLabel } from '../../lib/displayLabels';
import { t } from '../../lib/i18n';
import { groupById, optionLabel, swatchOf } from '../../lib/oddlingsBuilder';
import { pictureTileUrl, SLIDER_SCALES, sliderPosition, sliderValue, swatchBands } from '../../lib/oddlingsCatalog';
import { colors } from '../../theme';

type Group = NonNullable<ReturnType<typeof groupById>>;
interface Props { group: Group; value: string; onPick: (groupId: string, value: string) => void }
const labelOf = (group: Group, value: string) => value ? displayLabel(optionLabel(group.id, value)) : t('oddlingsStudio.any');
function Legend({ group, value }: Props) {
    return <Text accessibilityRole="header" style={styles.legend}>{displayLabel(group.label)}: {labelOf(group, value)}</Text>;
}
export function SwatchGroup(props: Props) {
    const { group, value, onPick } = props;
    return <View style={styles.group}><Legend {...props} /><View style={styles.wrap}>
        {['', ...group.options.map(([option]) => option)].map(option => <Pressable key={option} accessibilityRole="radio"
            accessibilityLabel={rawText(option ? `${displayLabel(group.label)}: ${labelOf(group, option)}` : t('oddlingsStudio.anyLabel', { label: displayLabel(group.label) }))}
            accessibilityState={{ selected: option === value }} onPress={() => onPick(group.id, option)} style={[styles.circle, option === value && styles.selected]}>
            {option ? swatchBands(swatchOf(group.id, option) ?? '').map((color, index) => <View key={index} style={{ backgroundColor: color, flex: 1, height: '100%' }} />) : <Text style={styles.label}>{t('oddlingsStudio.any')}</Text>}
        </Pressable>)}
    </View></View>;
}
export function SliderGroup(props: Props) {
    const { group, value, onPick } = props;
    const scale = SLIDER_SCALES[group.id] ?? [];
    const position = sliderPosition(group.id, { [group.id]: value });
    return <View style={styles.group}><Legend {...props} />
        <ScrollView horizontal><View style={styles.wrap} accessibilityRole="adjustable" accessibilityLabel={rawText(displayLabel(group.label))}
            accessibilityValue={{ min: 0, max: scale.length, now: position, text: labelOf(group, value) }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={({ nativeEvent }) => {
                if (nativeEvent.actionName === 'increment' || nativeEvent.actionName === 'decrement') onPick(group.id, sliderValue(group.id, position + (nativeEvent.actionName === 'increment' ? 1 : -1)));
            }}>
            {['', ...scale].map((option, index) => <Pressable key={option} accessibilityRole="radio" accessibilityLabel={rawText(`${displayLabel(group.label)}: ${labelOf(group, option)}`)}
                accessibilityState={{ selected: index === position }} onPress={() => onPick(group.id, option)} style={[styles.step, index === position && styles.selected]}>
                <Text style={styles.label}>{labelOf(group, option)}</Text>
            </Pressable>)}
        </View></ScrollView>
        <Text style={styles.label}>{[t('oddlingsStudio.any'), labelOf(group, scale[0]), labelOf(group, scale[scale.length - 1])].join(' · ')}</Text>
    </View>;
}
export function TileGroup(props: Props) {
    const { group, value, onPick } = props;
    return <View style={styles.group}><Legend {...props} /><View style={styles.tiles}>
        {['', ...group.options.map(([option]) => option)].map(option => {
            const label = option ? labelOf(group, option) : t('oddlingsStudio.none');
            const uri = pictureTileUrl(group.id, option);
            return <Pressable key={option} accessibilityRole="radio" accessibilityLabel={rawText(`${displayLabel(group.label)}: ${label}`)} accessibilityState={{ selected: option === value }}
                onPress={() => onPick(group.id, option)} style={[styles.tile, option === value && styles.selected]}>
                {uri ? <Image source={{ uri }} cachePolicy="disk" contentFit="cover" style={styles.picture} /> : <View style={styles.picture} />}
                <Text style={styles.label}>{label}</Text>
            </Pressable>;
        })}
    </View></View>;
}
const styles = StyleSheet.create({
    group: { gap: 8, marginBottom: 20 }, legend: { color: colors.text, fontWeight: '700', fontSize: 16 },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    circle: { width: 48, height: 48, borderRadius: 24, overflow: 'hidden', borderWidth: 2, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    step: { minWidth: 44, minHeight: 44, padding: 8, borderWidth: 2, borderColor: colors.border, borderRadius: 8, justifyContent: 'center' },
    tile: { width: '31.8%', minHeight: 44, padding: 4, gap: 4, borderWidth: 2, borderColor: colors.border, borderRadius: 8 },
    selected: { borderColor: colors.accent }, picture: { width: '100%', aspectRatio: 1, borderRadius: 4, backgroundColor: colors.surface },
    label: { color: colors.body, fontSize: 12, textAlign: 'center' },
});
