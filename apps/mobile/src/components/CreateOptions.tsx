import { rawText } from '../lib/i18n/translate';
import { Text, TextField, Button, Chip, themedStyles, useThemedStyles } from './ui';
import { useState } from 'react';
import { View } from 'react-native';

import { IMAGE_COUNTS, SEED_MAX, VOICE_MAX, audioLengthInvalid, seedIsInvalid, type ModelOptions } from '../lib/createOptions';
import { t } from '../lib/i18n';
import { ds } from '../theme';

export interface OptionValues {
    readonly aspect: string | null;
    readonly count: number;
    readonly seed: string;
    readonly negative: string;
    readonly voice: string;
    readonly audioSeconds: string;
    // Unset means the model's priced default (resolveResolution / resolveAudio).
    readonly resolution?: string | null;
    readonly audio?: boolean | null;
}

interface Props {
    readonly options: ModelOptions;
    readonly values: OptionValues;
    // True for image models: they can make one to four images in one go.
    readonly showCount: boolean;
    // The resolution and audio choices shown now, already resolved to defaults, and the price line that goes with them.
    readonly resolution?: string | null;
    readonly audio?: boolean | null;
    readonly outputPrice?: string;
    readonly onChange: (next: OptionValues) => void;
}

// The web Create page's shape, image count and Settings (seed, leave out), for the options a model's catalog entry
// declares (ADR-0153). The server checks every value again, so a control that does not apply is simply not shown.
export function CreateOptions({ options, values, showCount, resolution, audio, outputPrice, onChange }: Props) {
    const styles = useThemedStyles(sheets);
    const [open, setOpen] = useState(values.seed !== '' || values.negative !== '');
    const bad = seedIsInvalid(values.seed);
    const settings = options.seed || options.negativeMax !== null;
    const set = (patch: Partial<OptionValues>) => onChange({ ...values, ...patch });

    return (
        <View style={styles.wrap}>
            {options.aspects.length > 0 ? (
                <Group label={t('opt.aspect')}>
                    {options.aspects.map((a) => (
                        <Chip key={a} label={a} accessibilityLabel={rawText(a)} selected={values.aspect === a} onPress={() => set({ aspect: a })} />
                    ))}
                </Group>
            ) : null}
            {options.resolutions.length > 0 ? (
                <Group label={t('opt.resolution')}>
                    {options.resolutions.map((r) => (
                        <Chip key={r} label={r} accessibilityLabel={rawText(r)} selected={resolution === r} onPress={() => set({ resolution: r })} />
                    ))}
                </Group>
            ) : null}
            {options.audioChoice ? (
                <Group label={t('opt.audio')}>
                    <Chip label={t('opt.audioOn')} accessibilityLabel={t('opt.audioOn')} selected={audio === true} onPress={() => set({ audio: true })} />
                    <Chip label={t('opt.audioOff')} accessibilityLabel={t('opt.audioOff')} selected={audio === false} onPress={() => set({ audio: false })} />
                </Group>
            ) : null}
            {outputPrice && (options.resolutions.length > 0 || options.audioChoice) ? (
                <Text variant="footnote" tone="warning" accessibilityLiveRegion="polite">{outputPrice}</Text>
            ) : null}
            {options.voice ? (
                <View style={styles.field}>
                    <Text variant="bodyStrong" tone="secondary" style={styles.fieldLabel}>{t('opt.voice')}</Text>
                    <TextField
                        style={[styles.input, styles.negative]}
                        value={values.voice}
                        onChangeText={(v) => set({ voice: v })}
                        placeholder={t('opt.voiceExample')}
                        placeholderTextColor={styles.mutedInk.color}
                        multiline
                        maxLength={VOICE_MAX}
                        accessibilityLabel={t('opt.voice')}
                    />
                    <Text variant="caption" tone="tertiary" style={styles.help}>{t('opt.voiceHelp')}</Text>
                </View>
            ) : null}
            {options.audioLength ? (
                <View style={styles.field}>
                    <Text variant="bodyStrong" tone="secondary" style={styles.fieldLabel}>{t('opt.audioLength')}</Text>
                    <TextField
                        style={[styles.input, styles.seed]}
                        error={audioLengthInvalid(options, values.audioSeconds)}
                        value={values.audioSeconds}
                        onChangeText={(v) => set({ audioSeconds: v.replace(/\s/g, '').slice(0, 4) })}
                        placeholder={String(options.audioLength.def)}
                        placeholderTextColor={styles.mutedInk.color}
                        keyboardType="number-pad"
                        accessibilityLabel={t('opt.audioLength')}
                    />
                    <Text variant="caption" tone="tertiary" style={[styles.help, audioLengthInvalid(options, values.audioSeconds) && styles.helpBad]} accessibilityLiveRegion="polite">
                        {t('opt.audioLengthRange', { min: String(options.audioLength.min), max: String(options.audioLength.max), def: String(options.audioLength.def) })}
                    </Text>
                </View>
            ) : null}
            {showCount ? (
                <Group label={t('opt.count')}>
                    {IMAGE_COUNTS.map((n) => (
                        <Chip key={n} label={String(n)} accessibilityLabel={rawText(String(n))} selected={values.count === n} onPress={() => set({ count: n })} />
                    ))}
                </Group>
            ) : null}
            {settings ? (
                <View style={styles.settings}>
                    <Button variant="tertiary" label={t('opt.settings')} accessibilityRole="button" accessibilityLabel={rawText(open ? t('opt.settingsHide') : t('opt.settingsShow'))} accessibilityState={{ expanded: open }} icon={open ? 'caretDown' : 'caretRight'} onPress={() => setOpen(!open)} />
                    {open ? (
                        <View style={styles.fields}>
                            {options.seed ? (
                                <View style={styles.field}>
                                    <Text variant="bodyStrong" tone="secondary" style={styles.fieldLabel}>{t('opt.seed')}</Text>
                                    <View style={styles.seedRow}>
                                        <TextField
                                            containerStyle={styles.seedField} style={[styles.input, styles.seed]}
                                            error={bad}
                                            value={values.seed}
                                            onChangeText={(v) => set({ seed: v.replace(/\s/g, '').slice(0, 10) })}
                                            placeholder={t('opt.seedPlaceholder')}
                                            placeholderTextColor={styles.mutedInk.color}
                                            keyboardType="number-pad"
                                            accessibilityLabel={t('opt.seed')}
                                        />
                                        <Button variant="secondary" accessibilityRole="button" accessibilityLabel={t('opt.rollLabel')} onPress={() => set({ seed: String(Math.floor(Math.random() * SEED_MAX)) })} label={t('opt.roll')} />
                                    </View>
                                    <Text variant="caption" tone="tertiary" style={[styles.help, bad && styles.helpBad]} accessibilityLiveRegion="polite">
                                        {bad ? t('opt.seedRange', { max: String(SEED_MAX) }) : t('opt.seedHelp')}
                                    </Text>
                                </View>
                            ) : null}
                            {options.negativeMax !== null ? (
                                <View style={styles.field}>
                                    <Text variant="bodyStrong" tone="secondary" style={styles.fieldLabel}>{t('opt.exclude')}</Text>
                                    <TextField
                                        style={[styles.input, styles.negative]}
                                        value={values.negative}
                                        onChangeText={(v) => set({ negative: v })}
                                        placeholder={t('opt.excludeHint')}
                                        placeholderTextColor={styles.mutedInk.color}
                                        multiline
                                        maxLength={options.negativeMax}
                                        accessibilityLabel={t('opt.exclude')}
                                    />
                                    <Text variant="caption" tone="tertiary" style={styles.help}>{t('opt.excludeCount', { count: String(values.negative.length), max: String(options.negativeMax) })}</Text>
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
    const styles = useThemedStyles(sheets);
    return (
        <View style={styles.group} accessibilityLabel={rawText(label)}>
            <Text variant="bodyStrong" tone="secondary" style={styles.label}>{label}</Text>
            <View style={styles.chips}>{children}</View>
        </View>
    );
}

const sheets = themedStyles((p) => ({
    mutedInk: { color: p.textTertiary },

    wrap: { gap: ds.space.md },
    group: { gap: ds.space.sm },
    label: { color: p.textSecondary, },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    settings: { backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: ds.radius.md, paddingHorizontal: ds.space.md },
    fields: { gap: ds.space.md, paddingBottom: ds.space.md },
    field: { gap: ds.space.sm },
    fieldLabel: { color: p.textSecondary, },
    seedField: { flex: 1 },
    seedRow: { flexDirection: 'row', gap: ds.space.sm },
    input: { color: p.textPrimary },
    seed: { flex: 1, minHeight: 44 },
    negative: { minHeight: 70, textAlignVertical: 'top' },
    help: { color: p.textTertiary, },
    helpBad: { color: p.danger },
}));
