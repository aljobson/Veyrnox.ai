import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ScrollViewInstance } from 'react-native';
import { studioColors as colors, ds, type } from '../../../theme';
import { touchTarget } from '../../../lib/a11y';
import { t, rawText } from '../../../lib/i18n';
import { Text as AnnouncedText } from '../../ui/Text';
export function ColourField({ label, value, swatches, onChange, presentation = 'grid', commitValidOnChange = false, onOpenPicker }: {
    label: string; value: string; swatches: readonly string[]; onChange(hex: string): void;
    presentation?: 'grid' | 'horizontal'; commitValidOnChange?: boolean; onOpenPicker?(): Promise<string | null>;
}) {
    const [draft, setDraft] = useState(value), [invalid, setInvalid] = useState(false);
    const [pickerPending, setPickerPending] = useState(false);
    const mounted = useRef(true), currentValue = useRef(value);
    const scroll = useRef<ScrollViewInstance>(null);
    const palette = useMemo(() => {
        const seen = new Set<string>();
        return swatches.filter(hex => { const key = hex.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
    }, [swatches]);
    useEffect(() => { currentValue.current = value; setDraft(value); setInvalid(false); }, [value]);
    useEffect(() => () => { mounted.current = false; }, []);
    useEffect(() => {
        if (presentation !== 'horizontal') return;
        const index = palette.findIndex(hex => hex.toLowerCase() === value.toLowerCase());
        if (index >= 0) requestAnimationFrame(() => scroll.current?.scrollTo?.({ x: Math.max(0, index * 54 - 16), animated: false }));
    }, [palette, presentation, value]);
    const choices = palette.map(hex => <Pressable key={hex.toLowerCase()} accessibilityRole="button"
        accessibilityLabel={rawText(t('editorTools.colourSwatch', { hex }))} accessibilityState={{ selected: value.toLowerCase() === hex.toLowerCase() }}
        onPress={() => { setDraft(hex); setInvalid(false); if (hex.toLowerCase() !== value.toLowerCase()) onChange(hex); }}
        style={[touchTarget, styles.swatch, presentation === 'horizontal' && styles.swatchCircle,
            { backgroundColor: hex }, value.toLowerCase() === hex.toLowerCase() ? styles.swatchSelected : styles.swatchIdle]} />);
    return <View style={styles.field}>
        <View style={styles.labelRow}>
            <Text style={styles.label}>{label}</Text>
            {onOpenPicker ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${label} picker`} disabled={pickerPending}
                onPress={async () => {
                    const openedValue = currentValue.current; setPickerPending(true);
                    try {
                        const selected = await onOpenPicker();
                        if (mounted.current && currentValue.current === openedValue && selected && selected.toLowerCase() !== openedValue.toLowerCase()) onChange(selected);
                    } finally { if (mounted.current) setPickerPending(false); }
                }} style={[touchTarget, styles.pickerButton, pickerPending && styles.pickerPending]}>
                <View pointerEvents="none" style={styles.colorWheel}><View style={styles.colorWheelCenter} /></View>
            </Pressable> : null}
        </View>
        {presentation === 'horizontal' ? <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchesHorizontal}>{choices}</ScrollView>
            : <View style={styles.swatches}>{choices}</View>}
        <TextInput accessibilityLabel={rawText(t('editorTools.colourHex', { label }))} value={draft} autoCapitalize="none" maxLength={7}
            onChangeText={hex => {
                setDraft(hex);
                if (commitValidOnChange && /^#[0-9a-fA-F]{6}$/.test(hex)) { setInvalid(false); if (hex.toLowerCase() !== value.toLowerCase()) onChange(hex); }
            }} onEndEditing={event => {
                const hex = event.nativeEvent.text;
                const valid = /^#[0-9a-fA-F]{6}$/.test(hex); setInvalid(!valid);
                if (valid && hex.toLowerCase() !== value.toLowerCase()) onChange(hex);
            }} style={[touchTarget, styles.input]} />
        {invalid ? <AnnouncedText variant="inherit" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{t('editorTools.colourError')}</AnnouncedText> : null}
    </View>;
}
const styles = StyleSheet.create({
    field: { gap: ds.space.sm }, labelRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    label: { ...type.label, color: colors.text },
    pickerButton: { alignItems: 'center', justifyContent: 'center' }, pickerPending: { opacity: .45 },
    colorWheel: { width: 34, height: 34, borderRadius: 17, borderWidth: 5, borderTopColor: '#FF453A', borderRightColor: '#FFD60A', borderBottomColor: '#34C759', borderLeftColor: '#0A84FF', alignItems: 'center', justifyContent: 'center' },
    colorWheelCenter: { width: 13, height: 13, borderRadius: 7, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    swatchesHorizontal: { gap: 10, paddingHorizontal: 1, paddingVertical: 3 },
    swatch: { borderWidth: 2, borderRadius: ds.space.xs },
    swatchCircle: { width: 44, height: 44, minWidth: 44, minHeight: 44, borderRadius: 22 },
    swatchIdle: { borderColor: colors.border },
    swatchSelected: { borderColor: colors.accent, borderWidth: 3 },
    input: { ...type.body, color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: ds.space.xs, padding: ds.space.sm },
    error: { ...type.body, color: colors.danger },
});
