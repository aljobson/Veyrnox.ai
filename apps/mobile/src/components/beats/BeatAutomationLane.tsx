import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, SegmentedControl, Text, themedStyles, useThemedStyles } from '../ui';
import { STEP_TICKS, loopSteps } from '../../lib/beatNative/doc';
import { addAutomationPoint, moveAutomationPoint, removeAutomationPoint, clearAutomation, setAutomationCurve, automationEnvelope, envelopeAt,
    type MixDoc, type MixTrack, type Lane, type MixApply } from '../../lib/beatNative/mix';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';

const MAX_TICK = 512 * 3840;
const HEIGHT = 160;
export function BeatAutomationLane({ doc, track, lane, step, playing, apply, onHide }: {
    doc: MixDoc; track: MixTrack; lane: Lane; step: number | null; playing: boolean; apply: MixApply; onHide(): void;
}) {
    const s = useThemedStyles(sheets);
    const [selected, select] = useState<number | null>(null);
    const [width, setWidth] = useState(1);
    const points = track.automation?.[lane] ?? [];
    const point = selected === null ? undefined : points[selected];
    const min = lane === 'gain' ? 0 : -1;
    const end = Math.min(MAX_TICK, Math.max(loopSteps(doc) * STEP_TICKS, (points.at(-1)?.[0] ?? 0) + STEP_TICKS));
    const title = t('beatMix.lane.title', { track: track.name, lane: t(`beatMix.lane.${lane}`) });
    const x = (tick: number) => tick / end * Math.max(1, width - 44) + 22;
    const y = (value: number) => 22 + (1 - (value - min) / (1 - min)) * (HEIGHT - 44);
    const add = (tick: number) => {
        tick = Math.max(0, Math.min(MAX_TICK, Math.round(tick / STEP_TICKS) * STEP_TICKS));
        const existing = points.findIndex(p => p[0] === tick);
        if (existing >= 0) { select(existing); return; }
        const value = points.length ? envelopeAt(automationEnvelope(points, doc.tempo.bpm), tick / 960 * 60 / doc.tempo.bpm) : track[lane];
        if (apply(d => addAutomationPoint(d, track.id, lane, tick, value))) select(points.filter(p => p[0] < tick).length);
    };
    const move = (tick: number, value: number) => {
        if (selected === null || !point) return;
        apply(d => moveAutomationPoint(d, track.id, lane, selected, tick, Math.max(min, Math.min(1, Number(value.toFixed(4))))), undefined, `${track.id}:auto:${lane}:${selected}`);
    };
    // 44 pt targets of neighbouring points overlap; a touch picks the point whose dot is nearest, not the last-drawn target.
    const nearest = (atX: number, atY: number) => points.reduce((best, q, i) =>
        Math.hypot(x(q[0]) - atX, y(q[1]) - atY) < Math.hypot(x(points[best][0]) - atX, y(points[best][1]) - atY) ? i : best, 0);
    const earlier = point ? point[0] - STEP_TICKS : 0, later = point ? point[0] + STEP_TICKS : 0;
    return <View style={s.lane}>
        <Text accessibilityRole="header" variant="title3">{title}</Text>
        <Button label={t('beatMix.lane.add')} onPress={() => add(playing && step !== null ? step * STEP_TICKS : points.length ? points[points.length - 1][0] + STEP_TICKS : 0)} />
        <Button variant="secondary" label={t('beatMix.lane.clear')} disabled={!points.length} onPress={() => { if (apply(d => clearAutomation(d, track.id, lane))) select(null); }} />
        <Button variant="tertiary" label={t('beatMix.lane.hide')} onPress={onHide} />
        <View style={s.surface} onLayout={e => setWidth(Math.max(1, e.nativeEvent.layout.width))}>
            <Pressable style={s.background} accessibilityRole="button" accessibilityLabel={t('beatMix.lane.surface', { lane: t(`beatMix.lane.${lane}`) })}
                onPress={e => add((e.nativeEvent.locationX - 22) / Math.max(1, width - 44) * end)} />
            {points.slice(0, -1).map((p, i) => {
                const next = points[i + 1], dx = x(next[0]) - x(p[0]), dy = y(next[1]) - y(p[1]), length = Math.hypot(dx, dy);
                return <View key={`line${i}`} pointerEvents="none" style={[s.segment, { left: (x(p[0]) + x(next[0]) - length) / 2, top: (y(p[1]) + y(next[1])) / 2,
                    width: length, transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }] }]} />;
            })}
            {points.map((p, i) => <Pressable key={`${i}:${p[0]}`} style={[s.pointHit, { left: x(p[0]) - 22, top: y(p[1]) - 22 }]}
                accessibilityRole="button" accessibilityState={{ selected: i === selected }}
                accessibilityLabel={t('beatMix.lane.point', { lane: t(`beatMix.lane.${lane}`), n: i + 1, bar: Math.floor(p[0] / 3840) + 1,
                    beat: Number((p[0] % 3840 / 960 + 1).toFixed(2)), value: t('beatMix.unit.percent', { value: Math.round(p[1] * 100) }) })}
                onPress={e => select(nearest(x(p[0]) - 22 + (e?.nativeEvent?.locationX ?? 22), y(p[1]) - 22 + (e?.nativeEvent?.locationY ?? 22)))}><View style={[s.dot, i === selected && s.selected]} /></Pressable>)}
        </View>
        {point && selected !== null && <View style={s.editor}>
            <Text>{t('beatMix.lane.selected', { n: selected + 1 })}</Text>
            <Button variant="secondary" label={t('beatMix.lane.earlier')} disabled={earlier < 0 || earlier <= (points[selected - 1]?.[0] ?? -1)} onPress={() => move(earlier, point[1])} />
            <Button variant="secondary" label={t('beatMix.lane.later')} disabled={later > MAX_TICK || later >= (points[selected + 1]?.[0] ?? Infinity)} onPress={() => move(later, point[1])} />
            {[-0.1, -0.01, 0.01, 0.1].map(delta => <Button key={delta} variant="secondary" label={t(delta < 0 ? 'beatMix.lane.decrease' : 'beatMix.lane.increase', { value: t('beatMix.unit.percent', { value: Math.abs(delta * 100) }) })}
                disabled={delta < 0 ? point[1] <= min : point[1] >= 1} onPress={() => move(point[0], point[1] + delta)} />)}
            <SegmentedControl accessibilityLabel={t('beatMix.lane.curve')} value={String(point[2])}
                options={[{ value: '0', label: t('beatMix.curve.linear') }, { value: '-0.6', label: t('beatMix.curve.in') }, { value: '0.6', label: t('beatMix.curve.out') }]}
                onChange={v => apply(d => setAutomationCurve(d, track.id, lane, selected, Number(v)))} />
            {![0, -0.6, 0.6].includes(point[2]) && <Text>{t('beatMix.curve.custom', { value: point[2] })}</Text>}
            <Button variant="tertiary" label={t('beatMix.lane.delete')} onPress={() => { if (apply(d => removeAutomationPoint(d, track.id, lane, selected))) select(null); }} />
        </View>}
    </View>;
}
const sheets = themedStyles(p => ({
    lane: { gap: ds.space.sm }, editor: { gap: ds.space.sm },
    surface: { height: HEIGHT, backgroundColor: p.bgElevated2, borderRadius: ds.radius.md, overflow: 'hidden' },
    background: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
    segment: { position: 'absolute', height: 2, backgroundColor: p.accent },
    pointHit: { position: 'absolute', width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    dot: { width: 10, height: 10, borderRadius: ds.radius.pill, backgroundColor: p.accent },
    selected: { borderWidth: 2, borderColor: p.textPrimary, width: 16, height: 16, borderRadius: ds.radius.pill },
}));
