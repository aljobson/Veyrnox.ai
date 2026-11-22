import { View } from 'react-native';
import { Button, SegmentedControl, Text, themedStyles, useThemedStyles } from '../ui';
import { ds } from '../../theme';
import { t } from '../../lib/i18n';
import { selectPattern, setRegionPattern, setAudioRegion, type BeatDoc, type BeatRegionDoc, type BeatTrackDoc } from '../../lib/beatNative/doc';
import { regionActions, type Apply } from '../../lib/beatNative/regionActions';

type Props = { doc: BeatDoc; track: BeatTrackDoc; region: BeatRegionDoc; snap: number; locator: number; apply: Apply };
function AudioControls({ region, apply }: Pick<Props, 'region' | 'apply'>) {
    const s = useThemedStyles(sheets);
    const gain = region.gainDb ?? 0;
    const fadeIn = Math.round((region.fadeIn?.endSec ?? 0) * 1000);
    const fadeOut = Math.round((region.fadeOut?.startBeforeEndSec ?? 0) * 1000);
    const inAnchor = region.fadeIn?.startSec ?? 0;
    const outAnchor = region.fadeOut?.endBeforeEndSec ?? 0;
    // Clamp to a whole-millisecond endpoint strictly after the preserved anchor.
    const minimum = (anchor: number) => anchor === 0 ? 0 : Math.max(0, Math.floor(anchor * 1000) + 1);
    const maximum = (anchor: number) => Math.min(10000, Math.floor((anchor + 10) * 1000));
    const fields = [
        { label: t('beat.audio.gain'), value: gain, min: -24, max: 6, step: 1, partial: false, change: (value: number) => ({ gainDb: value }) },
        { label: t('beat.audio.fadeIn'), value: fadeIn, min: minimum(inAnchor), max: maximum(inAnchor), step: 50, partial: inAnchor !== 0,
            change: (value: number) => ({ fadeIn: value === 0 && inAnchor === 0 ? null : { startSec: inAnchor, endSec: value / 1000 } }) },
        { label: t('beat.audio.fadeOut'), value: fadeOut, min: minimum(outAnchor), max: maximum(outAnchor), step: 50, partial: outAnchor !== 0,
            change: (value: number) => ({ fadeOut: value === 0 && outAnchor === 0 ? null : { startBeforeEndSec: value / 1000, endBeforeEndSec: outAnchor } }) },
    ];
    return <>
        {fields.map(field => <View key={field.label} style={s.group}>
            <Text>{t('beat.audio.value', { field: field.label, value: field.value })}</Text>
            {field.partial && <Text variant="footnote">{t('beat.audio.partialFade', { field: field.label })}</Text>}
            <View style={s.row}>{[-1, 1].map(direction => <Button key={direction} size="md" variant="secondary"
                label={t(direction < 0 ? 'beat.value.decrease' : 'beat.value.increase', { field: field.label })}
                disabled={field.min > field.max || (direction < 0 ? field.value <= field.min : field.value >= field.max)}
                onPress={() => apply(d => setAudioRegion(d, region.id, field.change(Math.max(field.min, Math.min(field.max, field.value + direction * field.step)))), t('beat.region.changed'))} />)}</View>
        </View>)}
        <Button size="md" variant="secondary" label={t('beat.audio.reverse')} accessibilityState={{ selected: !!region.reverse }}
            onPress={() => apply(d => setAudioRegion(d, region.id, { reverse: !region.reverse }), t('beat.region.changed'))} />
        <Text variant="footnote">{t('beat.audio.webOnly')}</Text>
    </>;
}
export function BeatRegionInspector({ doc, track, region, snap, locator, apply }: Props) {
    const s = useThemedStyles(sheets);
    return <View style={s.group} testID="region-inspector">
        <Text variant="bodyStrong" accessibilityRole="header">{t('beat.region.inspector')}</Text>
        {region.pattern && <SegmentedControl accessibilityLabel={t('beat.region.pattern')} value={region.pattern}
            options={(['A', 'B', 'C', 'D'] as const).map(value => ({ value, label: value, accessibilityLabel: t('beat.region.patternNamed', { pattern: value }) }))}
            onChange={pattern => apply(d => selectPattern(setRegionPattern(d, region.id, pattern), pattern), t('beat.region.changed'))} />}
        <View style={s.row}>{regionActions(doc, track, region, snap, locator).map(action => <Button key={action.name} size="md"
            variant={action.name === 'delete' ? 'destructive' : 'secondary'} label={action.label} onPress={() => apply(action.operation, action.label)} />)}</View>
        {region.assetId && <AudioControls region={region} apply={apply} />}
    </View>;
}
const sheets = themedStyles(() => ({
    group: { gap: ds.space.sm },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
}));
