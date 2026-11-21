import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { MUSIC_BPM_MAX, MUSIC_BPM_MIN, MUSIC_EXCLUDE_STYLES_MAX, MUSIC_KEY_SCALES, MUSIC_TIME_SIGNATURES } from '../../lib/music/shared';
import { bpmInvalid } from '../../lib/music/createForm';
import type { MusicInputSnapshot, MusicModelControls } from '../../lib/music/types';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';
import { StrengthSlider } from '../StrengthSlider';
import { PickSheet, type PickChoice } from '../oddlings/PickSheet';
import { Button, Text, TextField } from '../ui';

type AdvancedInput = Pick<MusicInputSnapshot, 'variety' | 'styleInfluence' | 'excludeStyles' | 'bpm' | 'keyScale' | 'timeSignature'>;
type AdvancedPatch = Partial<AdvancedInput>;
type Picker = 'key' | 'meter' | null;

const keyChoices: readonly PickChoice[] = MUSIC_KEY_SCALES.map(value => ({ value, label: value }));
const meterChoices: readonly PickChoice[] = MUSIC_TIME_SIGNATURES.map(({ value, label }) => ({ value, label: label ?? value }));
const hasActiveValues = (input: AdvancedInput): boolean => input.variety !== 50 || input.styleInfluence !== 0
    || !!input.excludeStyles.trim() || !!input.bpm.trim() || !!input.keyScale || !!input.timeSignature;

export function MusicAdvancedControls({ input, controls, onChange }: {
    input: AdvancedInput; controls: MusicModelControls; onChange: (patch: AdvancedPatch) => void;
}) {
    // A remount (mode switch, navigation away/back) must not hide settings that still affect the quote,
    // especially an invalid BPM that disables Review.
    const [expanded, setExpanded] = useState(() => hasActiveValues(input) || bpmInvalid(input.bpm));
    const [picker, setPicker] = useState<Picker>(null);
    const available = controls.variety || controls.style_influence || controls.exclude_styles || controls.tempo_key_meter;
    if (!available) return null;
    const invalidBpm = controls.tempo_key_meter && bpmInvalid(input.bpm);
    const auto = t('music.create.advanced.auto');
    const keyLabel = t('music.create.advanced.key');
    const meterLabel = t('music.create.advanced.meter');
    const selectedKey = input.keyScale || auto;
    const selectedMeter = meterChoices.find(choice => choice.value === input.timeSignature)?.label ?? auto;
    return <View style={styles.section}>
        <Button variant="secondary" label={t(expanded ? 'music.create.advanced.hide' : 'music.create.advanced.show')}
            accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} />
        {expanded ? <View style={styles.controls}>
            {controls.variety ? <View style={styles.field}>
                <Text variant="bodyStrong">{t('music.create.advanced.variety')}</Text>
                <StrengthSlider tone="surface" step={0.01} label={t('music.create.advanced.variety')} value={input.variety / 100}
                    valueText={t('music.create.advanced.percent', { value: input.variety })}
                    onChange={value => onChange({ variety: Math.round(value * 100) })} />
                <Text variant="footnote" tone="secondary">{t('music.create.advanced.varietyHelp')}</Text>
            </View> : null}
            {controls.style_influence ? <View style={styles.field}>
                <Text variant="bodyStrong">{t('music.create.advanced.styleInfluence')}</Text>
                <StrengthSlider tone="surface" step={0.01} label={t('music.create.advanced.styleInfluence')} value={input.styleInfluence / 100}
                    valueText={t('music.create.advanced.percent', { value: input.styleInfluence })}
                    onChange={value => onChange({ styleInfluence: Math.round(value * 100) })} />
                <Text variant="footnote" tone="secondary">{t('music.create.advanced.styleInfluenceHelp')}</Text>
            </View> : null}
            {controls.exclude_styles ? <TextField label={t('music.create.advanced.excludeStyles')} value={input.excludeStyles}
                maxLength={MUSIC_EXCLUDE_STYLES_MAX} placeholder={t('music.create.advanced.excludeStylesPlaceholder')}
                onChangeText={excludeStyles => onChange({ excludeStyles })} /> : null}
            {controls.tempo_key_meter ? <>
                <TextField label={t('music.create.advanced.bpm')} value={input.bpm} keyboardType="number-pad"
                    placeholder={auto} maxLength={3} error={invalidBpm ? t('music.create.advanced.bpmInvalid', { min: MUSIC_BPM_MIN, max: MUSIC_BPM_MAX }) : undefined}
                    onChangeText={bpm => onChange({ bpm })} />
                <View style={styles.field}>
                    <Text variant="footnote" tone="secondary">{keyLabel}</Text>
                    <Button variant="secondary" label={selectedKey} accessibilityLabel={`${keyLabel}, ${selectedKey}`}
                        accessibilityState={{ expanded: picker === 'key' }} onPress={() => setPicker('key')} />
                </View>
                <View style={styles.field}>
                    <Text variant="footnote" tone="secondary">{meterLabel}</Text>
                    <Button variant="secondary" label={selectedMeter} accessibilityLabel={`${meterLabel}, ${selectedMeter}`}
                        accessibilityState={{ expanded: picker === 'meter' }} onPress={() => setPicker('meter')} />
                </View>
            </> : null}
        </View> : null}
        {picker === 'key' ? <PickSheet title={keyLabel} choices={keyChoices} value={input.keyScale}
            noneLabel={auto} onPick={keyScale => onChange({ keyScale })} onClose={() => setPicker(null)} /> : null}
        {picker === 'meter' ? <PickSheet title={meterLabel} choices={meterChoices} value={input.timeSignature}
            noneLabel={auto} onPick={timeSignature => onChange({ timeSignature })} onClose={() => setPicker(null)} /> : null}
    </View>;
}

const styles = StyleSheet.create({
    section: { gap: ds.space.md },
    controls: { gap: ds.space.lg },
    field: { gap: ds.space.xs },
});
