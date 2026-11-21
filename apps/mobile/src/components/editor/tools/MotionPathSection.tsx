import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ds } from '../../../theme';
import { t, rawText, formatNumber } from '../../../lib/i18n';
import { EASINGS, type Transform } from '../../../lib/editorMotionEdit';
import type { Clip, TextClip } from '../../../lib/nativeEditorModel';
import { exportRefusal } from '../../../lib/editorExportRefusal';
import { Action, Choice, PanelHeading } from '../EditorControls';
import { styles } from '../fullEditorStyles';
import { useEditorFrame } from '../editorFrameStore';
import { SegmentedChoice } from './SegmentedChoice';
import { TransformSliders } from './TransformSection';
import type { MotionActions } from './useMotionActions';
export function EasingChoice({ value, onChange }: { value: string; onChange(value: string): void }) {
    const labels: Record<string, string> = { linear: t('editorMotion.linear'), 'ease-in': t('editorMotion.ease-in'),
        'ease-out': t('editorMotion.ease-out'), 'ease-in-out': t('editorMotion.ease-in-out') };
    return <SegmentedChoice label={t('editorMotion.easing')} value={value} onChange={onChange}
        options={EASINGS.map(value => ({ value, label: labels[value] }))} />;
}
function PointTimeStepper({ frame, fps, onChange }: { frame: number; fps: number; onChange(frame: number): void }) {
    const label = t('editorMotion.time', { s: formatNumber(frame / fps, 2) });
    return <View style={[styles.stepper, { gap: ds.space.sm, paddingHorizontal: ds.space.sm, paddingVertical: ds.space.xs }]}>
        <Text style={[styles.fieldLabel, styles.stepperCopy]}>{label}</Text>
        <View style={[styles.stepperActions, { gap: ds.space.sm }]}>{([-1, 1] as const).map(delta => {
            const disabled = delta < 0 ? frame <= -18000 : frame >= 18000;
            return <Pressable key={delta} accessibilityRole="button" accessibilityLabel={rawText(delta < 0
                ? t('editor.decrease', { value1: label }) : t('editor.increase', { value1: label }))}
                accessibilityState={{ disabled }} disabled={disabled} style={styles.stepperButton}
                onPress={() => onChange(Math.max(-18000, Math.min(18000, frame + delta)))}>
                <Text style={styles.stepperButtonText}>{delta < 0 ? '−' : '+'}</Text>
            </Pressable>;
        })}</View>
    </View>;
}
export function MotionPathSection({ clip, fps, actions, text }: { clip: Clip | TextClip; fps: number; actions: MotionActions; text: boolean }) {
    const frame = useEditorFrame(actions.frameStore), at = frame - clip.start, keys = clip.keyframes ?? [];
    const presets = { 'pan-right': t('editorMotion.pan-right'), rise: t('editorMotion.rise'), arc: t('editorMotion.arc'), 'push-in': t('editorMotion.push-in') };
    const [preset, setPreset] = useState('pan-right'), [expanded, setExpanded] = useState<number | null>(null);
    const changeTime = (index: number, next: number) => {
        if (actions.point(index, 'frame', next)) setExpanded(keys.map((key, i) => ({ frame: i === index ? next : key.frame, i }))
            .sort((a, b) => a.frame - b.frame).findIndex(key => key.i === index));
    };
    return <View style={{ gap: ds.space.sm }}>
        <PanelHeading detail="" title={t('editorMotion.path')} />
        <SegmentedChoice label={t('editorMotion.preset')} value={preset} onChange={setPreset}
            options={Object.entries(presets).map(([value, label]) => ({ value, label }))} />
        <Action label={t('editorMotion.apply')} onPress={() => actions.preset(preset)} />
        <Action label={t('editorMotion.add')} disabled={at < 0 || at >= clip.len || keys.length >= 40} onPress={actions.add} />
        {keys.map((key, index) => <View key={index} style={{ gap: ds.space.sm }}>
            <Choice label={t('editorMotion.point', { n: index + 1, s: formatNumber(key.frame / fps, 2) })}
                selected={expanded === index} onPress={() => setExpanded(expanded === index ? null : index)} />
            {expanded === index ? <>
                <PointTimeStepper frame={key.frame} fps={fps} onChange={n => changeTime(index, n)} />
                <Action label={t('editorMotion.move')} onPress={() => changeTime(index, actions.frameStore.get() - clip.start)} />
                <TransformSliders value={key as unknown as Transform} onChange={(name, n) => actions.point(index, name, n)} />
                <EasingChoice value={String(key.easing)} onChange={n => actions.point(index, 'easing', n)} />
                <Action label={t('editorMotion.go')} disabled={key.frame < 0 || key.frame >= clip.len} onPress={() => actions.go(index)} />
                <Action label={t('editorMotion.delete', { n: index + 1 })} onPress={() => { if (actions.remove(index)) setExpanded(null); }} />
            </> : null}
        </View>)}
        <Action label={t('editorMotion.clear')} disabled={!keys.length} onPress={actions.clear} />
        <Text style={styles.muted}>{t('editorMotion.pathHelp')}</Text>
        {text ? <Text style={styles.muted}>{t('editorMotion.textNote')}</Text> : null}
        {keys.length ? <Text style={styles.muted}>{exportRefusal('keyframes')}</Text> : null}
    </View>;
}
