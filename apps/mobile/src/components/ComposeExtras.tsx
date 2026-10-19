import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { touchTarget } from '../lib/a11y';
import { t } from '../lib/i18n';
import { captionLimit, networkLabel, YOUTUBE_VISIBILITIES, type YoutubeVisibility } from '../lib/publishCompose';
import type { PublishQueue } from '../lib/publishQueues';
import { slotLabel } from '../lib/publishQueues';
import { colors } from '../theme';

// ADR-0149: the parts of the Publish composer added in parity phase P5.

// One optional text box per chosen network. Empty means the main text is used.
export function NetworkTextFields({ networks, values, onChange }: { networks: readonly string[]; values: Readonly<Record<string, string>>; onChange: (network: string, text: string) => void }) {
    if (networks.length === 0) return null;
    return (
        <View style={styles.box}>
            {networks.map((n) => {
                const limit = captionLimit(n);
                const label = t('compose.networkText', { network: networkLabel(n) });
                const v = values[n] ?? '';
                return (
                    <View key={n} style={styles.field}>
                        <Text style={styles.label}>{label}</Text>
                        <TextInput style={styles.input} multiline value={v} onChangeText={(x) => onChange(n, x)} accessibilityLabel={label} accessibilityHint={t('compose.networkTextHint')} placeholder={t('compose.networkTextHint')} placeholderTextColor={colors.muted} />
                        {limit !== null && v.length > 0 ? <Text style={[styles.muted, [...v].length > limit && styles.over]}>{t('compose.networkTextCount', { count: [...v].length, limit })}</Text> : null}
                    </View>
                );
            })}
        </View>
    );
}

export function YoutubeVisibilityChips({ value, onChange }: { value: YoutubeVisibility; onChange: (v: YoutubeVisibility) => void }) {
    return (
        <View>
            <Text style={styles.label} accessibilityRole="header">{t('compose.youtube')}</Text>
            <View style={styles.chips}>
                {YOUTUBE_VISIBILITIES.map((v) => (
                    <Pressable key={v} accessibilityRole="button" accessibilityState={{ selected: value === v }} style={[styles.chip, touchTarget, value === v && styles.chipOn]} onPress={() => onChange(v)}>
                        <Text style={[styles.chipText, value === v && styles.chipTextOn]}>{t(`compose.youtube.${v}`)}</Text>
                    </Pressable>
                ))}
            </View>
        </View>
    );
}

export function QueuePicker({ queues, value, onChange }: { queues: readonly PublishQueue[]; value: string | null; onChange: (id: string) => void }) {
    return (
        <View>
            <Text style={styles.label}>{t('compose.queuePick')}</Text>
            {queues.map((q) => (
                <Pressable key={q.id} accessibilityRole="button" accessibilityState={{ selected: value === q.id }} style={[styles.row, touchTarget, value === q.id && styles.chipOn]} onPress={() => onChange(q.id)}>
                    <Text style={[styles.chipText, value === q.id && styles.chipTextOn]}>{q.name}</Text>
                    <Text style={[styles.muted, value === q.id && styles.chipTextOn]}>{q.slots.slice(0, 4).map(slotLabel).join(', ')}{q.slots.length > 4 ? ' …' : ''}</Text>
                </Pressable>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    box: { gap: 10 },
    field: { gap: 4 },
    label: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 6 },
    input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, minHeight: 48 },
    muted: { color: colors.muted, fontSize: 13 },
    over: { color: colors.danger },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
    chip: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    row: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 6, gap: 2 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
});
