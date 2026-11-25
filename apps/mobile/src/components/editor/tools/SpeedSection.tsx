import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SPEED_PRESETS, visibleSpeedPoints } from '../../../../../../app/veyrnox/_lib/editorSpeed.mjs';
import { studioColors as colors, ds, type } from '../../../theme';
import { t, formatNumber } from '../../../lib/i18n';
import { isMovingClip, type SpeedPoint } from '../../../lib/editorSpeedEdit';
import { clipAt, type Clip, type Selection, type Timeline } from '../../../lib/nativeEditorModel';
import { Action, Choice } from '../EditorControls';
import { Slider } from './Slider';
import { SegmentedChoice } from './SegmentedChoice';
import type { SpeedActions } from './useSpeedActions';
const presets = SPEED_PRESETS as Record<string, SpeedPoint[]>;
export function SpeedSection({ timeline, selection, actions }: { timeline: Timeline; selection: Selection | null; actions: SpeedActions }) {
    const clip = clipAt(timeline, selection) as Clip | undefined;
    const media = timeline.media[clip?.mediaId ?? ''];
    if (!clip || selection?.track === 'text' || ['image', 'graphic'].includes(media?.kind ?? '')) return null;
    if (clip.freezeFrame === undefined && !isMovingClip(timeline, selection)) return null;
    const key = JSON.stringify([clip.id, clip.len, clip.rate, clip.speedCurve, clip.freezeFrame]);
    return <SpeedControls key={key} clip={clip} fps={timeline.fps} video={selection?.track === 'video'} actions={actions} />;
}
function SpeedControls({ clip, fps, video, actions }: { clip: Clip; fps: number; video: boolean; actions: SpeedActions }) {
    const [points, setPoints] = useState<SpeedPoint[]>(() => visibleSpeedPoints(clip));
    const [preset, setPreset] = useState(clip.speedCurve?.length ? 'custom' : 'constant');
    const presetLabels = { constant: t('editorTools.constant'), smooth: t('editorTools.smooth'), accelerate: t('editorTools.accelerate'),
        decelerate: t('editorTools.decelerate'), pulse: t('editorTools.pulse'), custom: t('editorTools.custom') };
    const rateText = (value: number) => t('editorTools.rateValue', { value: formatNumber(value, 1) });
    const positionText = (value: number) => t('editorTools.positionValue', { value: formatNumber(value, 1) });
    const update = (index: number, patch: Partial<SpeedPoint>) => {
        setPreset('custom'); setPoints(points.map((point, at) => at === index ? { ...point, ...patch } : point));
    };
    useEffect(() => {
        if (!clip.speedCurve?.length) return;
        const match = Object.keys(presets).find(name => JSON.stringify(presets[name].map(p => ({ frame: p.position * clip.len, rate: p.rate }))) === JSON.stringify(clip.speedCurve));
        setPreset(match ?? 'custom');
    }, [clip.len, clip.speedCurve]);
    return <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>{t('editorTools.speed')}</Text>
        {clip.freezeFrame !== undefined ? <>
            <Text style={styles.body}>{t('editorTools.freezeHelp')}</Text>
            <Slider label={t('editorTools.freezeLength')} value={clip.len} min={1} max={Math.max(300, clip.len)} step={1} snaps={[30, 60, 90]}
                format={value => t('editorTools.secondsValue', { value: formatNumber(value / fps, 1) })} onChange={actions.freezeLength} />
            <Action label={t('editorTools.freezeRemove')} danger onPress={actions.removeFreeze} />
        </> : <>
            <Slider label={t('editorTools.constantRate')} value={clip.rate ?? 1} min={.1} max={8} step={.1} snaps={[.5, 1, 2]}
                format={rateText} onChange={actions.changeSpeed} />
            <SegmentedChoice label={t('editorTools.preset')} value={preset}
                options={Object.entries(presetLabels).map(([value, label]) => ({ value, label }))}
                onChange={name => {
                    if (name === 'constant') actions.changeSpeed(clip.rate ?? 1);
                    else if (presets[name]) actions.changeCurve(presets[name]);
                    else setPreset('custom');
                }} />
            <Text style={styles.body}>{t('editorTools.keyframeHelp')}</Text>
            {points.map((point, index) => <View key={index} style={styles.section}>
                <Slider label={t('editorTools.pointPosition', { n: index + 1 })} value={point.position * 100}
                    min={index === 0 ? 0 : points[index - 1].position * 100 + .1}
                    max={index === points.length - 1 ? 100 : points[index + 1].position * 100 - .1} step={.1}
                    disabled={index === 0 || index === points.length - 1} format={positionText} onChange={value => update(index, { position: value / 100 })} />
                <Slider label={t('editorTools.pointRate', { n: index + 1 })} value={point.rate} min={.1} max={8} step={.1}
                    format={rateText} onChange={rate => update(index, { rate })} />
                {index > 0 && index < points.length - 1 ? <Action label={t('editorTools.pointDelete', { n: index + 1 })}
                    onPress={() => { setPreset('custom'); setPoints(points.filter((_, at) => at !== index)); }} /> : null}
            </View>)}
            <Action label={t('editorTools.pointAdd')} disabled={points.length >= 12} onPress={() => {
                const gaps = points.slice(1).map((point, index) => ({ position: (points[index].position + point.position) / 2,
                    rate: (points[index].rate + point.rate) / 2, gap: point.position - points[index].position })).sort((a, b) => b.gap - a.gap);
                const { position, rate } = gaps[0]; setPreset('custom'); setPoints([...points, { position, rate }].sort((a, b) => a.position - b.position));
            }} />
            <Action label={t('editorTools.curveApply')} onPress={() => actions.changeCurve(points)} />
            <Choice label={t('editor.reverse')} selected={!!clip.reverse} onPress={actions.toggleReverse} />
            {clip.reverse ? <Text style={styles.body}>{t('editorTools.reverseNote')}</Text> : null}
            {video ? <Action label={t('editorTools.freezeInsert')} onPress={actions.insertFreeze} /> : null}
        </>}
    </View>;
}
const styles = StyleSheet.create({
    section: { gap: ds.space.md }, heading: { ...type.label, color: colors.text }, body: { ...type.body, color: colors.text },
});
