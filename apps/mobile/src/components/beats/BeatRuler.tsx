import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';
import { ds } from '../../theme';
import { t } from '../../lib/i18n';
import { barTicks, clampLocator, setCycle, snapTick, type BeatCycle } from '../../lib/beatNative/doc';
import { tickToX, xToTick } from '../../lib/beatNative/arrange';
import { position, type Apply } from '../../lib/beatNative/regionActions';
import { useRegionHold } from '../../lib/beatNative/useRegionHold';

type Controls = { locator: number; end: number; setLocator: (tick: number) => void; cycle: BeatCycle; apply: Apply };
export function BeatRulerControls({ locator, end, setLocator, cycle, apply }: Controls) {
    const s = useThemedStyles(sheets);
    const positions = [
        { label: t('beat.ruler.start'), tick: 0 }, { label: t('beat.ruler.previous'), tick: locator - barTicks },
        { label: t('beat.ruler.next'), tick: locator + barTicks }, { label: t('beat.ruler.end'), tick: end },
    ];
    return <>
        <Text accessibilityLiveRegion="polite">{position(locator)}</Text>
        <View style={s.controls}>{positions.map(item => <Button key={item.label} size="md" variant="secondary" label={item.label} onPress={() => setLocator(clampLocator(item.tick, end))} />)}</View>
        <Button size="md" variant="secondary" label={t(cycle.on ? 'beat.cycle.on' : 'beat.cycle.off')} accessibilityState={{ selected: cycle.on }}
            onPress={() => apply(d => setCycle(d, { ...d.cycle, on: !d.cycle.on }), t('beat.cycle.changed'))} />
        <View style={s.controls}>
            <Button size="md" variant="secondary" label={t('beat.cycle.start')} onPress={() => apply(d => setCycle(d, { ...d.cycle, start: locator }), t('beat.cycle.changed'))} />
            <Button size="md" variant="secondary" label={t('beat.cycle.end')} onPress={() => apply(d => setCycle(d, { ...d.cycle, end: locator }), t('beat.cycle.changed'))} />
        </View>
    </>;
}
type Props = Controls & { bars: number; zoom: number; snap: number; lock: (held: boolean) => void; announce: (message: string) => void };
function CycleHandle({ edge, props, preview }: { edge: 'start' | 'end'; props: Props; preview: (cycle: BeatCycle | null) => void }) {
    const s = useThemedStyles(sheets);
    const handlers = useRegionHold({
        value: dx => {
            const at = Math.max(0, Math.min(512 * barTicks, snapTick(props.cycle[edge] + xToTick(dx, props.zoom), props.snap)));
            return { ...props.cycle, [edge]: edge === 'start' ? Math.min(at, props.cycle.end - 240) : Math.max(at, props.cycle.start + 240) };
        },
        preview, lock: props.lock, announce: props.announce, select: () => undefined, heldMessage: t('beat.cycle.moving'),
        commit: cycle => props.apply(d => setCycle(d, cycle), t('beat.cycle.changed')),
    });
    return <View pointerEvents="box-none" style={[s.handleHit, edge === 'start' ? { left: 0, top: 0 } : { right: 0, bottom: 0 }]}><View {...handlers} testID={`cycle-${edge}`} pointerEvents="box-only" hitSlop={10} accessible accessibilityRole="adjustable"
        accessibilityLabel={t(edge === 'start' ? 'beat.cycle.startHandle' : 'beat.cycle.endHandle')} accessibilityValue={{ text: position(props.cycle[edge]) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event => props.apply(d => setCycle(d, { ...d.cycle, [edge]: d.cycle[edge] + (event.nativeEvent.actionName === 'increment' ? props.snap : -props.snap) }), t('beat.cycle.changed'))}
        style={s.handle} /></View>;
}
export function BeatRuler(props: Props) {
    const s = useThemedStyles(sheets);
    const [preview, setPreview] = useState<BeatCycle | null>(null);
    const band = preview ?? props.cycle;
    return <View testID="beat-ruler" style={s.ruler}>
        <Pressable testID="ruler-position" style={s.numbers} accessibilityRole="adjustable" accessibilityLabel={t('beat.ruler.position')}
            accessibilityValue={{ min: 0, max: props.end / 240, now: props.locator / 240, text: position(props.locator) }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={event => props.setLocator(clampLocator(props.locator + (event.nativeEvent.actionName === 'increment' ? props.snap : -props.snap), props.end))}
            onPress={event => props.setLocator(clampLocator(snapTick(xToTick(event.nativeEvent.locationX, props.zoom), props.snap), props.end))}>
            {Array.from({ length: props.bars }, (_, index) => <Text key={index} pointerEvents="none" accessible={false} style={{ position: 'absolute', left: index * props.zoom }} variant="caption">{index + 1}</Text>)}
        </Pressable>
        <View pointerEvents="box-none" style={{ height: 88, left: tickToX(band.start, props.zoom), width: Math.max(44, tickToX(band.end - band.start, props.zoom)) }}>
            <View testID="cycle-band" pointerEvents="none" style={[s.band, { width: tickToX(band.end - band.start, props.zoom) }, band.on && s.on, preview && s.preview]} />
            <CycleHandle edge="start" props={props} preview={setPreview} /><CycleHandle edge="end" props={props} preview={setPreview} />
        </View>
    </View>;
}
export const RULER_HEIGHT = 132;
const sheets = themedStyles(p => ({
    controls: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    ruler: { height: RULER_HEIGHT, borderBottomWidth: 1, borderColor: p.borderSubtle },
    numbers: { height: 44 },
    band: { position: 'absolute', height: 88, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.surface },
    on: { borderColor: p.accent },
    preview: { opacity: 0.7 },
    handleHit: { position: 'absolute', width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    handle: { width: 24, height: 24, backgroundColor: p.accent, borderRadius: ds.radius.xs },
}));
