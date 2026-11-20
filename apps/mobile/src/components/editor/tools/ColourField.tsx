import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, ds, type } from '../../../theme';
import { touchTarget } from '../../../lib/a11y';
import { t, rawText } from '../../../lib/i18n';
import { useAnnouncement } from '../../../lib/useAnnouncement';
export function ColourField({ label, value, swatches, onChange }: {
    label: string; value: string; swatches: readonly string[]; onChange(hex: string): void;
}) {
    const [draft, setDraft] = useState(value), [invalid, setInvalid] = useState(false);
    useAnnouncement(invalid ? t('editorTools.colourError') : null);
    useEffect(() => { setDraft(value); setInvalid(false); }, [value]);
    return <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.swatches}>{swatches.map(hex => <Pressable key={hex} accessibilityRole="button"
            accessibilityLabel={rawText(t('editorTools.colourSwatch', { hex }))} accessibilityState={{ selected: value.toLowerCase() === hex.toLowerCase() }}
            onPress={() => { setDraft(hex); setInvalid(false); onChange(hex); }}
            style={[touchTarget, styles.swatch, { backgroundColor: hex, borderColor: value.toLowerCase() === hex.toLowerCase() ? colors.accent : colors.border }]} />)}</View>
        <TextInput accessibilityLabel={rawText(t('editorTools.colourHex', { label }))} value={draft} autoCapitalize="none" maxLength={7}
            onChangeText={setDraft} onEndEditing={event => {
                const hex = event.nativeEvent.text;
                const valid = /^#[0-9a-fA-F]{6}$/.test(hex); setInvalid(!valid);
                if (valid) onChange(hex);
            }} style={[touchTarget, styles.input]} />
        {invalid ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{t('editorTools.colourError')}</Text> : null}
    </View>;
}
const styles = StyleSheet.create({
    field: { gap: ds.space.sm }, label: { ...type.label, color: colors.text },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm }, swatch: { borderWidth: 2, borderRadius: ds.space.xs },
    input: { ...type.body, color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: ds.space.xs, padding: ds.space.sm },
    error: { ...type.body, color: colors.danger },
});
