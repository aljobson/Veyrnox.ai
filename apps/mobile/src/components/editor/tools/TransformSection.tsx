import { Text, View } from 'react-native';
import { ds } from '../../../theme';
import { t, formatNumber } from '../../../lib/i18n';
import { evaluatedAt, TRANSFORM_DEFAULTS, type Transform } from '../../../lib/editorMotionEdit';
import type { Clip } from '../../../lib/nativeEditorModel';
import { exportRefusal } from '../../../lib/editorExportRefusal';
import { Choice, PanelHeading } from '../EditorControls';
import { styles } from '../fullEditorStyles';
import { useEditorFrame } from '../editorFrameStore';
import { Slider } from './Slider';
import type { MotionActions } from './useMotionActions';
export const motionFields = [
    { key: 'x', label: 'editorMotion.x', min: -200, max: 300, factor: 100, snap: 50 },
    { key: 'y', label: 'editorMotion.y', min: -200, max: 300, factor: 100, snap: 50 },
    { key: 'scale', label: 'editorMotion.scale', min: 5, max: 800, factor: 100, snap: 100 },
    { key: 'rotation', label: 'editorMotion.rotation', min: -360, max: 360, factor: 1, snap: 0 },
    { key: 'opacity', label: 'editorMotion.opacity', min: 0, max: 100, factor: 100 },
] as const;
export function TransformSliders({ value, onChange }: { value: Pick<Transform, 'x' | 'y' | 'scale' | 'rotation' | 'opacity'>;
    onChange(key: typeof motionFields[number]['key'], value: number): void }) {
    return <>{motionFields.map(field => <Slider key={field.key} label={t(field.label)} value={value[field.key] * field.factor}
        min={field.min} max={field.max} step={1} snaps={'snap' in field ? [field.snap] : undefined}
        format={n => `${formatNumber(n, 0)}${field.factor === 1 ? '°' : '%'}`} onChange={n => onChange(field.key, n / field.factor)} />)}</>;
}
export function TransformSection({ clip, actions }: { clip: Clip; actions: MotionActions }) {
    const frame = useEditorFrame(actions.frameStore), value = evaluatedAt(clip, frame).transform;
    const active = !!clip.keyframes?.length || Object.entries(TRANSFORM_DEFAULTS).some(([key, v]) => clip.transform?.[key as keyof Transform] !== undefined
        && clip.transform[key as keyof Transform] !== v);
    return <View style={{ gap: ds.space.sm }}>
        <PanelHeading detail="" title={t('editorMotion.transform')} />
        <TransformSliders value={value} onChange={actions.transform} />
        <View style={styles.choices}>{([{ key: 'flipX', label: 'editorMotion.flipX' }, { key: 'flipY', label: 'editorMotion.flipY' }] as const).map(({ key, label }) =>
            <Choice key={key} label={t(label)} selected={value[key]} onPress={() => actions.transform(key, !value[key])} />)}</View>
        {clip.keyframes?.length ? <Text style={styles.muted}>{t('editorMotion.replaces')}</Text> : null}
        {active ? <Text style={styles.muted}>{exportRefusal('transform')}</Text> : null}
        <Text style={styles.muted}>{t('editorMotion.layersNote')}</Text>
    </View>;
}
