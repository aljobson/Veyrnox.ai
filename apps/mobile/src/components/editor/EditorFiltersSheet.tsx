import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useOptionalSafeAreaInsets } from '../../lib/safeArea';
import type { Clip } from '../../lib/nativeEditorModel';
import { studioColors as colors, fonts } from '../../theme';
import { Slider } from './tools/Slider';

type FilterPreset = 'none' | 'natural' | 'warm' | 'crisp' | 'mono';
const PRESETS: readonly { id: FilterPreset; name: string; swatch: string }[] = [
    { id: 'none', name: 'None', swatch: '#303034' }, { id: 'natural', name: 'Natural', swatch: '#8fa78a' },
    { id: 'warm', name: 'Warm', swatch: '#c78655' }, { id: 'crisp', name: 'Crisp', swatch: '#77a3b7' }, { id: 'mono', name: 'Mono', swatch: '#8b8b8d' },
];
export function editorFilterPreset(id: FilterPreset, strength: number): NonNullable<Clip['filter']> {
    const amount = Math.max(0, Math.min(1, strength));
    if (id === 'natural') return { brightness: .03 * amount, contrast: 1 + .08 * amount, saturate: 1 + .08 * amount, hue: 0, blur: 0 };
    if (id === 'warm') return { brightness: .04 * amount, contrast: 1 + .1 * amount, saturate: 1 + .18 * amount, hue: 8 * amount, blur: 0 };
    if (id === 'crisp') return { brightness: .02 * amount, contrast: 1 + .22 * amount, saturate: 1 + .08 * amount, hue: -3 * amount, blur: 0 };
    if (id === 'mono') return { brightness: 0, contrast: 1 + .16 * amount, saturate: 1 - amount, hue: 0, blur: 0 };
    return { brightness: 0, contrast: 1, saturate: 1, hue: 0, blur: 0 };
}

export function EditorFiltersSheet({ visible, clip, onClose, onPatch }: { visible: boolean; clip: Clip | null; onClose(): void; onPatch(patch: Partial<Clip>): void }) {
    const insets = useOptionalSafeAreaInsets();
    const [preset, setPreset] = useState<FilterPreset>('none'), [strength, setStrength] = useState(1);
    const apply = (nextPreset = preset, nextStrength = strength) => onPatch({ filter: editorFilterPreset(nextPreset, nextStrength) });
    return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} accessibilityViewIsModal>
        <Pressable accessible={false} style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(24, (insets?.bottom ?? 0) + 14) }]}>
            <View style={styles.grabber} /><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Close Filters" onPress={onClose} style={styles.close}><Text style={styles.closeText}>Close</Text></Pressable><Text accessibilityRole="header" style={styles.title}>Filters</Text></View>
            {clip ? <><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presets}>{PRESETS.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.name} filter`} accessibilityState={{ selected: preset === item.id }} onPress={() => { setPreset(item.id); apply(item.id, strength); }} style={styles.preset}><View style={[styles.preview, { backgroundColor: item.swatch }, preset === item.id && styles.previewSelected]} /><Text style={[styles.presetText, preset === item.id && styles.presetTextSelected]}>{item.name}</Text></Pressable>)}</ScrollView>
                <Slider label="Intensity" value={strength} min={0} max={1} step={.05} disabled={preset === 'none'} format={value => `${Math.round(value * 100)}%`} onChange={value => { setStrength(value); apply(preset, value); }} />
                <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={onClose} style={styles.primary}><Text style={styles.primaryText}>Done</Text></Pressable></>
                : <View style={styles.empty}><Text style={styles.emptyTitle}>Select a video clip</Text><Text style={styles.emptyBody}>Choose a clip in the timeline to apply a filter.</Text></View>}
        </View>
    </Modal>;
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.58)' }, sheet: { gap: 18, paddingHorizontal: 20, paddingTop: 10, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: '#303034', backgroundColor: '#1a1a1c' },
    grabber: { width: 42, height: 5, alignSelf: 'center', borderRadius: 3, backgroundColor: '#c7c3d4' }, header: { minHeight: 48, alignItems: 'center', justifyContent: 'center' }, close: { position: 'absolute', start: 0, minWidth: 60, minHeight: 44, justifyContent: 'center' }, closeText: { color: colors.accent, fontSize: 16, fontWeight: '700' }, title: { color: colors.text, fontFamily: fonts.display, fontSize: 20 },
    presets: { gap: 14, paddingEnd: 10 }, preset: { width: 74, alignItems: 'center', gap: 7 }, preview: { width: 66, height: 82, borderRadius: 12, borderWidth: 2, borderColor: 'transparent' }, previewSelected: { borderColor: colors.accent }, presetText: { color: colors.body, fontSize: 13, fontWeight: '700' }, presetTextSelected: { color: colors.accent },
    primary: { minHeight: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 29, backgroundColor: colors.accent }, primaryText: { color: colors.accentInk, fontSize: 18, fontWeight: '900' },
    empty: { gap: 6, padding: 18, borderRadius: 18, backgroundColor: '#232326' }, emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '800', textAlign: 'center' }, emptyBody: { color: colors.muted, fontSize: 14, textAlign: 'center' },
});
