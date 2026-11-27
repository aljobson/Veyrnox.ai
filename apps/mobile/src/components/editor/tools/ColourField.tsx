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
    const scrollOffset = useRef(0), viewportWidth = useRef(0);
    const palette = useMemo(() => {
        const seen = new Set<string>();
        return swatches.filter(hex => { const key = hex.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
    }, [swatches]);
    useEffect(() => { currentValue.current = value; setDraft(value); setInvalid(false); }, [value]);
    useEffect(() => () => { mounted.current = false; }, []);
    useEffect(() => {
        if (presentation !== 'horizontal') return;
        const index = palette.findIndex(hex => hex.toLowerCase() === value.toLowerCase());
        if (index < 0) return;
        requestAnimationFrame(() => {
            const viewport = viewportWidth.current;
            if (viewport <= 0) return;
            const start = index * 54, end = start + 44;
            const visibleStart = scrollOffset.current, visibleEnd = visibleStart + viewport;
            if (start >= visibleStart && end <= visibleEnd) return;
            const x = Math.max(0, start - 10);
            scrollOffset.current = x;
            scroll.current?.scrollTo?.({ x, animated: false });
        });
    }, [palette, presentation, value]);
    const enhancedPresentation = presentation === 'horizontal' || Boolean(onOpenPicker);
    const choices = palette.map(hex => <Pressable key={hex.toLowerCase()} accessibilityRole="button"
        accessibilityLabel={rawText(t('editorTools.colourSwatch', { hex }))} accessibilityState={{ selected: value.toLowerCase() === hex.toLowerCase() }}
        onPress={() => { setDraft(hex); setInvalid(false); if (hex.toLowerCase() !== value.toLowerCase()) onChange(hex); }}
        style={[touchTarget, styles.swatch, presentation === 'horizontal' && styles.swatchCircle,
            { backgroundColor: hex }, value.toLowerCase() === hex.toLowerCase() ? styles.swatchSelected : styles.swatchIdle,
            value.toLowerCase() === hex.toLowerCase() && presentation === 'horizontal' && styles.swatchSelectedHorizontal]} />);
    return <View style={styles.field}>
        <View style={enhancedPresentation ? styles.labelRow : undefined}>
            <Text style={styles.label}>{label}</Text>
            {onOpenPicker ? <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('editorTools.colourPicker', { label }))} disabled={pickerPending}
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
        {presentation === 'horizontal' ? <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false}
            onLayout={event => {
                viewportWidth.current = event.nativeEvent.layout.width;
                const index = palette.findIndex(hex => hex.toLowerCase() === value.toLowerCase());
                if (index < 0) return;
                const start = index * 54, end = start + 44;
                if (start >= scrollOffset.current && end <= scrollOffset.current + viewportWidth.current) return;
                const x = Math.max(0, start - 10); scrollOffset.current = x; scroll.current?.scrollTo?.({ x, animated: false });
            }}
            onScroll={event => { scrollOffset.current = event.nativeEvent.contentOffset.x; }} scrollEventThrottle={16}
            contentContainerStyle={styles.swatchesHorizontal}>{choices}</ScrollView>
            : <View style={styles.swatches}>{choices}</View>}
        <TextInput accessibilityLabel={rawText(t('editorTools.colourHex', { label }))} value={draft} autoCapitalize="none" maxLength={7}
            onChangeText={hex => {
                setDraft(hex);
                if (commitValidOnChange && /^#[0-9a-fA-F]{6}$/.test(hex)) { setInvalid(false); if (hex.toLowerCase() !== value.toLowerCase()) onChange(hex.toUpperCase()); }
            }} onEndEditing={event => {
                const hex = event.nativeEvent.text;
                const valid = /^#[0-9a-fA-F]{6}$/.test(hex); setInvalid(!valid);
                if (valid && hex.toLowerCase() !== value.toLowerCase()) onChange(commitValidOnChange ? hex.toUpperCase() : hex);
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
    swatchSelected: { borderColor: colors.accent },
    swatchSelectedHorizontal: { borderWidth: 3 },
    input: { ...type.body, color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: ds.space.xs, padding: ds.space.sm },
    error: { ...type.body, color: colors.danger },
});
