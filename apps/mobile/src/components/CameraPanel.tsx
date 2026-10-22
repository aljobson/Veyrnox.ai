import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { selectedState } from '../lib/a11y';
import { APERTURES, CAMERAS, FOCAL_LENGTHS, LENSES, type Cinema } from '../lib/cinemaCamera';
import { t } from '../lib/i18n';
import { colors } from '../theme';

interface Props {
    readonly on: boolean;
    readonly value: Cinema;
    readonly onToggle: (on: boolean) => void;
    readonly onChange: (next: Cinema) => void;
}

// The web's Cinema camera: body, lens, focal length and aperture, written into the prompt as plain words. It changes
// the prompt only, never the model or the price (ADR-0175).
export function CameraPanel({ on, value, onToggle, onChange }: Props) {
    return (
        <View style={styles.box}>
            <View style={styles.head}>
                <Text style={styles.title} accessibilityRole="header">{t('cam.title')}</Text>
                <Switch accessibilityLabel={t('cam.title')} value={on} onValueChange={onToggle} trackColor={{ true: colors.accent, false: colors.border }} />
            </View>
            {on ? null : <Text style={styles.muted}>{t('cam.offHint')}</Text>}
            {on ? (
                <>
                    <Row label={t('cam.camera')} options={Object.keys(CAMERAS)} selected={value.camera} onPick={(camera) => onChange({ ...value, camera })} />
                    <Row label={t('cam.lens')} options={Object.keys(LENSES)} selected={value.lens} onPick={(lens) => onChange({ ...value, lens })} />
                    <Row label={t('cam.focal')} options={Object.keys(FOCAL_LENGTHS)} selected={String(value.focal)} suffix=" mm" onPick={(f) => onChange({ ...value, focal: Number(f) })} />
                    <Row label={t('cam.aperture')} options={Object.keys(APERTURES)} selected={value.aperture} onPick={(aperture) => onChange({ ...value, aperture })} />
                    <Text style={styles.muted}>{t('cam.help')}</Text>
                </>
            ) : null}
        </View>
    );
}

function Row({ label, options, selected, suffix = '', onPick }: { readonly label: string; readonly options: readonly string[]; readonly selected: string; readonly suffix?: string; readonly onPick: (v: string) => void }) {
    return (
        <View style={styles.row} accessibilityLabel={label}>
            <Text style={styles.label}>{label}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {options.map((o) => (
                    <Pressable key={o} accessibilityRole="button" accessibilityLabel={`${o}${suffix}`} accessibilityState={selectedState(selected === o)} style={[styles.chip, selected === o && styles.chipOn]} onPress={() => onPick(o)}>
                        <Text style={[styles.chipText, selected === o && styles.chipTextOn]}>{`${o}${suffix}`}</Text>
                    </Pressable>
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    box: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, gap: 8 },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 48 },
    title: { color: colors.text, fontWeight: '600', fontSize: 16 },
    row: { gap: 6 },
    label: { color: colors.body, fontSize: 13 },
    chips: { flexDirection: 'row', gap: 8 },
    chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    muted: { color: colors.muted, fontSize: 12, marginTop: -6, paddingBottom: 6 },
});
