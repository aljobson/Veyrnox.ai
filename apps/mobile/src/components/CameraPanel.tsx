import { Text, Card, Chip, themedStyles, useThemedStyles } from './ui';
import { ScrollView, Switch, View } from 'react-native';
import { selectedState } from '../lib/a11y';
import { APERTURES, CAMERAS, FOCAL_LENGTHS, LENSES, type Cinema } from '../lib/cinemaCamera';
import { t } from '../lib/i18n';
import { ds } from '../theme';

interface Props {
    readonly on: boolean;
    readonly value: Cinema;
    readonly onToggle: (on: boolean) => void;
    readonly onChange: (next: Cinema) => void;
}

// The web's Cinema camera: body, lens, focal length and aperture, written into the prompt as plain words. It changes
// the prompt only, never the model or the price (ADR-0175).
export function CameraPanel({ on, value, onToggle, onChange }: Props) {
    const styles = useThemedStyles(sheets);
    return (
        <Card style={styles.box}>
            <View style={styles.head}>
                <Text variant="title3" tone="primary" style={styles.title} accessibilityRole="header">{t('cam.title')}</Text>
                <Switch accessibilityLabel={t('cam.title')} value={on} onValueChange={onToggle} trackColor={{ true: styles.accentInk.color, false: styles.borderInk.color }} />
            </View>
            {on ? null : <Text variant="caption" tone="tertiary" style={styles.muted}>{t('cam.offHint')}</Text>}
            {on ? (
                <>
                    <Row label={t('cam.camera')} options={Object.keys(CAMERAS)} selected={value.camera} onPick={(camera) => onChange({ ...value, camera })} />
                    <Row label={t('cam.lens')} options={Object.keys(LENSES)} selected={value.lens} onPick={(lens) => onChange({ ...value, lens })} />
                    <Row label={t('cam.focal')} options={Object.keys(FOCAL_LENGTHS)} selected={String(value.focal)} suffix=" mm" onPick={(f) => onChange({ ...value, focal: Number(f) })} />
                    <Row label={t('cam.aperture')} options={Object.keys(APERTURES)} selected={value.aperture} onPick={(aperture) => onChange({ ...value, aperture })} />
                    <Text variant="caption" tone="tertiary" style={styles.muted}>{t('cam.help')}</Text>
                </>
            ) : null}
        </Card>
    );
}

function Row({ label, options, selected, suffix = '', onPick }: { readonly label: string; readonly options: readonly string[]; readonly selected: string; readonly suffix?: string; readonly onPick: (v: string) => void }) {
    const styles = useThemedStyles(sheets);
    return (
        <View style={styles.row} accessibilityLabel={label}>
            <Text variant="bodyStrong" tone="secondary" style={styles.label}>{label}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {options.map((o) => (
                    <Chip selected={selected === o} key={o} accessibilityRole="button" accessibilityLabel={`${o}${suffix}`} accessibilityState={selectedState(selected === o)} onPress={() => onPick(o)} label={`${o}${suffix}`} />
                ))}
            </ScrollView>
        </View>
    );
}

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },
    borderInk: { color: p.borderSubtle },

    box: { backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: ds.radius.md, paddingHorizontal: ds.space.md, paddingVertical: ds.space.sm, gap: ds.space.sm },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 48 },
    title: { color: p.textPrimary, },
    row: { gap: ds.space.sm },
    label: { color: p.textSecondary, },
    chips: { flexDirection: 'row', gap: ds.space.sm },
    muted: { color: p.textTertiary, marginTop: -6, paddingBottom: ds.space.sm },
}));
