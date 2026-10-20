import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { selectedState, touchTarget } from '../lib/a11y';
import { IMAGE_COUNTS, SEED_MAX, VOICE_MAX, audioLengthInvalid, seedIsInvalid, type ModelOptions } from '../lib/createOptions';
import { t } from '../lib/i18n';
import { colors } from '../theme';

export interface OptionValues {
    readonly aspect: string | null;
    readonly count: number;
    readonly seed: string;
    readonly negative: string;
    readonly voice: string;
    readonly audioSeconds: string;
}

interface Props {
    readonly options: ModelOptions;
    readonly values: OptionValues;
    // True for image models: they can make one to four images in one go.
    readonly showCount: boolean;
    readonly onChange: (next: OptionValues) => void;
}

// The web Create page's shape, image count and Settings (seed, leave out), for the options a model's catalog entry
// declares (ADR-0153). The server checks every value again, so a control that does not apply is simply not shown.
export function CreateOptions({ options, values, showCount, onChange }: Props) {
    const [open, setOpen] = useState(values.seed !== '' || values.negative !== '');
    const bad = seedIsInvalid(values.seed);
    const settings = options.seed || options.negativeMax !== null;
    const set = (patch: Partial<OptionValues>) => onChange({ ...values, ...patch });

    return (
        <View style={styles.wrap}>
            {options.aspects.length > 0 ? (
                <Group label={t('opt.aspect')}>
                    {options.aspects.map((a) => (
                        <Chip key={a} label={a} on={values.aspect === a} onPress={() => set({ aspect: a })} />
                    ))}
                </Group>
            ) : null}
            {options.voice ? (
                <View style={styles.field}>
                    <Text style={styles.fieldLabel}>{t('opt.voice')}</Text>
                    <TextInput
                        style={[styles.input, styles.negative]}
                        value={values.voice}
                        onChangeText={(v) => set({ voice: v })}
                        placeholder={t('opt.voiceExample')}
                        placeholderTextColor={colors.muted}
                        multiline
                        maxLength={VOICE_MAX}
                        accessibilityLabel={t('opt.voice')}
                    />
                    <Text style={styles.help}>{t('opt.voiceHelp')}</Text>
                </View>
            ) : null}
            {options.audioLength ? (
                <View style={styles.field}>
                    <Text style={styles.fieldLabel}>{t('opt.audioLength')}</Text>
                    <TextInput
                        style={[styles.input, styles.seed, audioLengthInvalid(options, values.audioSeconds) && styles.inputBad]}
                        value={values.audioSeconds}
                        onChangeText={(v) => set({ audioSeconds: v.replace(/\s/g, '').slice(0, 4) })}
                        placeholder={String(options.audioLength.def)}
                        placeholderTextColor={colors.muted}
                        keyboardType="number-pad"
                        accessibilityLabel={t('opt.audioLength')}
                    />
                    <Text style={[styles.help, audioLengthInvalid(options, values.audioSeconds) && styles.helpBad]} accessibilityLiveRegion="polite">
                        {t('opt.audioLengthRange', { min: String(options.audioLength.min), max: String(options.audioLength.max), def: String(options.audioLength.def) })}
                    </Text>
                </View>
            ) : null}
            {showCount ? (
                <Group label={t('opt.count')}>
                    {IMAGE_COUNTS.map((n) => (
                        <Chip key={n} label={String(n)} on={values.count === n} onPress={() => set({ count: n })} />
                    ))}
                </Group>
            ) : null}
            {settings ? (
                <View style={styles.settings}>
                    <Pressable accessibilityRole="button" accessibilityLabel={open ? t('opt.settingsHide') : t('opt.settingsShow')} accessibilityState={{ expanded: open }} style={[styles.toggle, touchTarget]} onPress={() => setOpen(!open)}>
                        <Text style={styles.label}>{t('opt.settings')}</Text>
                        <Text style={styles.muted}>{open ? '–' : '+'}</Text>
                    </Pressable>
                    {open ? (
                        <View style={styles.fields}>
                            {options.seed ? (
                                <View style={styles.field}>
                                    <Text style={styles.fieldLabel}>{t('opt.seed')}</Text>
                                    <View style={styles.seedRow}>
                                        <TextInput
                                            style={[styles.input, styles.seed, bad && styles.inputBad]}
                                            value={values.seed}
                                            onChangeText={(v) => set({ seed: v.replace(/\s/g, '').slice(0, 10) })}
                                            placeholder={t('opt.seedPlaceholder')}
                                            placeholderTextColor={colors.muted}
                                            keyboardType="number-pad"
                                            accessibilityLabel={t('opt.seed')}
                                        />
                                        <Pressable accessibilityRole="button" accessibilityLabel={t('opt.rollLabel')} style={[styles.roll, touchTarget]} onPress={() => set({ seed: String(Math.floor(Math.random() * SEED_MAX)) })}>
                                            <Text style={styles.rollText}>{t('opt.roll')}</Text>
                                        </Pressable>
                                    </View>
                                    <Text style={[styles.help, bad && styles.helpBad]} accessibilityLiveRegion="polite">
                                        {bad ? t('opt.seedRange', { max: String(SEED_MAX) }) : t('opt.seedHelp')}
                                    </Text>
                                </View>
                            ) : null}
                            {options.negativeMax !== null ? (
                                <View style={styles.field}>
                                    <Text style={styles.fieldLabel}>{t('opt.exclude')}</Text>
                                    <TextInput
                                        style={[styles.input, styles.negative]}
                                        value={values.negative}
                                        onChangeText={(v) => set({ negative: v })}
                                        placeholder={t('opt.excludeHint')}
                                        placeholderTextColor={colors.muted}
                                        multiline
                                        maxLength={options.negativeMax}
                                        accessibilityLabel={t('opt.exclude')}
                                    />
                                    <Text style={styles.help}>{t('opt.excludeCount', { count: String(values.negative.length), max: String(options.negativeMax) })}</Text>
                                </View>
                            ) : null}
                        </View>
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}

function Group({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
    return (
        <View style={styles.group} accessibilityLabel={label}>
            <Text style={styles.label}>{label}</Text>
            <View style={styles.chips}>{children}</View>
        </View>
    );
}

function Chip({ label, on, onPress }: { readonly label: string; readonly on: boolean; readonly onPress: () => void }) {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={selectedState(on)} style={[styles.chip, on && styles.chipOn]} onPress={onPress}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    wrap: { gap: 14 },
    group: { gap: 6 },
    label: { color: colors.body, fontWeight: '600' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body, fontWeight: '600' },
    chipTextOn: { color: colors.accentInk },
    settings: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14 },
    toggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    muted: { color: colors.muted, fontSize: 18 },
    fields: { gap: 14, paddingBottom: 14 },
    field: { gap: 6 },
    fieldLabel: { color: colors.body, fontSize: 13 },
    seedRow: { flexDirection: 'row', gap: 8 },
    input: { color: colors.text, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15 },
    seed: { flex: 1, minHeight: 44 },
    negative: { minHeight: 70, textAlignVertical: 'top' },
    inputBad: { borderColor: colors.danger },
    roll: { paddingHorizontal: 16, borderRadius: 10, borderColor: colors.border, borderWidth: 1, alignItems: 'center' },
    rollText: { color: colors.body, fontWeight: '600' },
    help: { color: colors.muted, fontSize: 12 },
    helpBad: { color: colors.danger },
});
