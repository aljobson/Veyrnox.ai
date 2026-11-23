import { StyleSheet, View } from 'react-native';
import { StrengthSlider } from '../StrengthSlider';
import { Button, SegmentedControl, Text, TextField } from '../ui';
import { t } from '../../lib/i18n';
import { modelCounterLimit } from '../../lib/music/createForm';
import type { MusicInputSnapshot, MusicModel, MusicSunoModel, MusicVocalGender } from '../../lib/music/types';
import { ds } from '../../theme';

const STYLE_KEYS = ['cinematic', 'electronic', 'indie', 'jazz', 'pop', 'rock'] as const;
const codePoints = (value: string) => Array.from(value);
export const capMusicText = (value: string, max: number): string => codePoints(value).slice(0, max).join('');
export function appendMusicStyle(value: string, addition: string, max: number): string {
    const parts = value.split(',').map(item => item.trim()).filter(Boolean);
    if (!parts.some(item => item.toLocaleLowerCase() === addition.toLocaleLowerCase())) parts.push(addition);
    return capMusicText(parts.join(', '), max);
}

function Counter({ value, max }: { value: string; max: number }) {
    return <Text variant="caption" tone="tertiary" accessibilityLiveRegion="polite">
        {t('music.create.counter', { count: codePoints(value).length, max })}
    </Text>;
}

function CountedField({ label, value, max, multiline, onChange }: {
    label: string; value: string; max: number; multiline?: boolean; onChange: (value: string) => void;
}) {
    return <View style={styles.field}>
        <TextField label={label} value={value} multiline={multiline} onChangeText={next => onChange(capMusicText(next, max))} />
        <Counter value={value} max={max} />
    </View>;
}

function StyleField({ kind, value, max, applied, onChange }: {
    kind: 'style' | 'exclude'; value: string; max: number; applied?: number; onChange: (value: string) => void;
}) {
    const label = t(kind === 'style' ? 'music.create.suno.style' : 'music.create.suno.exclude');
    return <View style={styles.section}>
        <CountedField label={label} value={value} max={max} multiline onChange={onChange} />
        <Text variant="footnote" tone="secondary">{t('music.create.suno.selectStyles')}</Text>
        <View style={styles.row}>{STYLE_KEYS.map(key => {
            const style = t(`music.create.suno.style.${key}`);
            return <Button key={key} size="md" variant="secondary" label={style}
                onPress={() => onChange(appendMusicStyle(value, style, max))} />;
        })}</View>
        {value ? <Button size="md" variant="tertiary" label={t('music.create.suno.clear')} onPress={() => onChange('')} /> : null}
        {kind === 'exclude' && Number.isSafeInteger(applied) ? <Text variant="footnote" tone="secondary">
            {t('music.create.suno.excludeNote', { count: applied! })}
        </Text> : null}
    </View>;
}

export function MusicSunoControls({ input, model, rights, onChange, onRights }: {
    input: MusicInputSnapshot; model: MusicModel; rights: boolean;
    onChange: (patch: Partial<MusicInputSnapshot>) => void; onRights: (value: boolean) => void;
}) {
    const titleMax = modelCounterLimit(model, 'title')!;
    const lyricsMax = modelCounterLimit(model, 'lyrics')!;
    const stylesMax = modelCounterLimit(model, 'styles')!;
    const excludeMax = modelCounterLimit(model, 'exclude_styles')!;
    const models = model.controls.suno_model ?? [];
    const genders = model.controls.vocal_gender ?? [];
    const variety = Array.isArray(model.controls.variety) ? model.controls.variety : [];
    const duration = model.controls.duration_seconds;
    const styleBounds = model.limits?.style_weight;
    const weirdBounds = model.limits?.weirdness;
    const styleWeight = input.styleInfluence / 100;
    return <View style={styles.section}>
        <CountedField label={t('music.create.songTitle')} value={input.title} max={titleMax} onChange={title => onChange({ title })} />
        {!input.instrumental ? <CountedField label={t('music.create.lyrics')} value={input.lyrics} max={lyricsMax} multiline onChange={lyrics => onChange({ lyrics })} /> : null}
        <StyleField kind="style" value={input.styles} max={stylesMax} onChange={styles => onChange({ styles })} />
        <StyleField kind="exclude" value={input.excludeStyles} max={excludeMax} applied={model.counters?.exclude_styles.applied}
            onChange={excludeStyles => onChange({ excludeStyles })} />
        <View style={styles.field}>
            <Text variant="bodyStrong">{t('music.create.suno.model')}</Text>
            <SegmentedControl value={input.sunoModel} options={models.map(value => ({ value, label: value }))}
                onChange={(sunoModel: MusicSunoModel) => onChange({ sunoModel })} />
        </View>
        {!input.instrumental ? <View style={styles.field}>
            <Text variant="bodyStrong">{t('music.create.suno.vocalGender')}</Text>
            <SegmentedControl value={input.vocalGender} options={genders.map(value => ({ value, label: t(`music.create.suno.gender.${value}`) }))}
                onChange={(vocalGender: MusicVocalGender) => onChange({ vocalGender })} />
        </View> : null}
        {styleBounds ? <View style={styles.field}>
            <Text variant="bodyStrong">{t('music.create.suno.styleWeight')}</Text>
            <StrengthSlider tone="surface" label={t('music.create.suno.styleWeight')} value={styleWeight}
                displayValue={Number(styleWeight.toFixed(2))} valueText={styleWeight.toFixed(2)}
                valueRange={{ min: styleBounds.min, max: styleBounds.max, now: styleWeight }} step={0.05}
                onChange={value => onChange({ styleInfluence: Math.round(value * 100) })} />
        </View> : null}
        {weirdBounds ? <View style={styles.field}>
            <Text variant="bodyStrong">{t('music.create.suno.weirdness')}</Text>
            <StrengthSlider tone="surface" label={t('music.create.suno.weirdness')} value={input.weirdness}
                displayValue={Number(input.weirdness.toFixed(2))} valueText={input.weirdness.toFixed(2)}
                valueRange={{ min: weirdBounds.min, max: weirdBounds.max, now: input.weirdness }} step={0.05}
                onChange={weirdness => onChange({ weirdness })} />
        </View> : null}
        {duration ? <View style={styles.field}>
            <Text variant="bodyStrong">{t('music.create.suno.duration')}</Text>
            <StrengthSlider tone="surface" label={t('music.create.suno.duration')}
                value={(input.duration - duration.min) / Math.max(1, duration.max - duration.min)}
                displayValue={input.duration} valueText={t('music.create.duration', { seconds: input.duration })}
                valueRange={{ min: duration.min, max: duration.max, now: input.duration }}
                step={1 / Math.max(1, duration.max - duration.min)}
                onChange={value => onChange({ duration: Math.round(duration.min + value * (duration.max - duration.min)) })} />
        </View> : null}
        <View style={styles.field}>
            <Text variant="bodyStrong">{t('music.create.suno.variety')}</Text>
            <View accessibilityRole="radiogroup" style={styles.row}>{variety.map((_label, index) => <Button key={index}
                size="md" variant={Math.round(input.variety / 25) === index ? 'primary' : 'secondary'}
                accessibilityRole="radio" accessibilityState={{ checked: Math.round(input.variety / 25) === index }}
                label={t(`music.create.suno.variety.${index}`)} onPress={() => onChange({ variety: index * 25 })} />)}</View>
        </View>
        {!input.instrumental ? <Button variant="secondary" accessibilityRole="checkbox" accessibilityState={{ checked: rights }}
            label={t('music.create.rights')} onPress={() => onRights(!rights)} /> : null}
    </View>;
}

const styles = StyleSheet.create({
    section: { gap: ds.space.lg },
    field: { gap: ds.space.sm },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
});
