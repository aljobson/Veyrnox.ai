import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { t } from '../../lib/i18n';
import { MOTIONS, SCENES, SHOWS, TONES, type Picks } from '../../lib/oddlingsBuilder';
import { colors } from '../../theme';

interface Props {
    picks: Picks;
    scene: string;
    motionId: string;
    onText: (key: string, value: string) => void;
    onOpen: (key: 'oddling_voice' | 'oddling_show' | 'motion') => void;
    onScene: (value: string) => void;
}

const known = (table: readonly (readonly [string, string])[], value: string | undefined) => (table.some(([label]) => label === value) ? (value as string) : t('oddlings.build.notSet'));

// The creator's own words: name, voice, why people follow them, the recurring show, canon and the first scene.
export function BuilderFields({ picks, scene, motionId, onText, onOpen, onScene }: Props) {
    return (
        <View>
            <Label text={t('oddlings.build.name')} />
            <TextInput style={styles.input} value={picks.oddling_name || ''} maxLength={40} onChangeText={(v) => onText('oddling_name', v)} accessibilityLabel={t('oddlings.build.name')} />
            <Label text={t('oddlings.build.voice')} />
            <Row text={known(TONES, picks.oddling_voice)} label={t('oddlings.build.voice')} onPress={() => onOpen('oddling_voice')} />
            <Label text={t('oddlings.build.reason')} />
            <TextInput style={styles.input} value={picks.oddling_obsession || ''} maxLength={140} onChangeText={(v) => onText('oddling_obsession', v)} accessibilityLabel={t('oddlings.build.reason')} />
            <Label text={t('oddlings.build.show')} />
            <Row text={known(SHOWS, picks.oddling_show)} label={t('oddlings.build.show')} onPress={() => onOpen('oddling_show')} />
            <Label text={t('oddlings.build.canon')} />
            <TextInput style={[styles.input, styles.multi]} value={picks.oddling_rule || ''} maxLength={160} multiline onChangeText={(v) => onText('oddling_rule', v)} accessibilityLabel={t('oddlings.build.canon')} />
            <Label text={t('oddlings.build.motion')} />
            <Row text={MOTIONS.find((m) => m.id === motionId)?.name ?? MOTIONS[0].name} label={t('oddlings.build.motion')} onPress={() => onOpen('motion')} />
            <Label text={t('oddlings.build.scene')} />
            <TextInput style={[styles.input, styles.multi]} value={scene} maxLength={300} multiline onChangeText={onScene} accessibilityLabel={t('oddlings.build.scene')} />
            <View style={styles.chips}>
                {SCENES.slice(0, 3).map((item, index) => (
                    <Pressable key={item} accessibilityRole="button" accessibilityLabel={`${t('oddlings.build.scenePick', { n: index + 1 })}: ${item}`} accessibilityState={{ selected: scene === item }} style={[styles.chip, scene === item && styles.chipOn]} onPress={() => onScene(item)}>
                        <Text style={[styles.chipText, scene === item && styles.chipTextOn]}>{t('oddlings.build.scenePick', { n: index + 1 })}</Text>
                    </Pressable>
                ))}
            </View>
        </View>
    );
}

const Label = ({ text }: { text: string }) => <Text style={styles.label}>{text}</Text>;

function Row({ text, label, onPress }: { text: string; label: string; onPress: () => void }) {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${text}`} style={styles.row} onPress={onPress}>
            <Text style={styles.rowText}>{text}</Text>
            <Text style={styles.chev} accessible={false}>›</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    label: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 16, marginBottom: 6 },
    input: { minHeight: MIN_TARGET, color: colors.text, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
    multi: { minHeight: 80, textAlignVertical: 'top' },
    row: { minHeight: MIN_TARGET, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12 },
    rowText: { color: colors.text, fontSize: 16, flex: 1 },
    chev: { color: colors.muted, fontSize: 22 },
    chips: { flexDirection: 'row', gap: 8, marginTop: 8 },
    chip: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body, fontSize: 14 },
    chipTextOn: { color: colors.accentInk, fontWeight: '700' },
});
