import { Switch, Text, View } from 'react-native';
import { ds } from '../../../theme';
import { t, rawText, formatNumber } from '../../../lib/i18n';
import { evaluatedAt } from '../../../lib/editorMotionEdit';
import type { Clip } from '../../../lib/nativeEditorModel';
import { exportRefusal } from '../../../lib/editorExportRefusal';
import { Action, PanelHeading } from '../EditorControls';
import { styles } from '../fullEditorStyles';
import { useEditorFrame } from '../editorFrameStore';
import { Slider } from './Slider';
import { SegmentedChoice } from './SegmentedChoice';
import { EasingChoice } from './MotionPathSection';
import type { MaskActions } from './useMaskActions';
const fields = [
    { key: 'feather', label: 'editorMotion.feather', min: 0, max: 25 }, { key: 'x', label: 'editorMotion.x', min: -100, max: 200 }, { key: 'y', label: 'editorMotion.y', min: -100, max: 200 },
    { key: 'width', label: 'editorMotion.width', min: 5, max: 200 }, { key: 'height', label: 'editorMotion.height', min: 5, max: 200 },
    { key: 'rotation', label: 'editorMotion.rotation', min: -360, max: 360 },
] as const;
export function MaskSection({ clip, fps, actions }: { clip: Clip; fps: number; actions: MaskActions }) {
    const frame = useEditorFrame(actions.frameStore), at = frame - clip.start, value = evaluatedAt(clip, frame).mask, keys = clip.maskKeyframes ?? [];
    const shapes = { none: t('editorMotion.none'), circle: t('editorMotion.circle'), rounded: t('editorMotion.rounded'),
        horizontal: t('editorMotion.horizontal'), vertical: t('editorMotion.vertical') };
    const active = !!clip.mask && clip.mask !== 'none';
    return <View style={{ gap: ds.space.sm }}>
        <PanelHeading detail="" title={t('editorMotion.mask')} />
        <SegmentedChoice label={t('editorMotion.shape')} value={clip.mask ?? 'none'} onChange={actions.shape}
            options={Object.entries(shapes).map(([value, label]) => ({ value, label }))} />
        {active ? <>
            <Text style={styles.fieldLabel}>{t('editorMotion.inverted')}</Text>
            <Switch accessibilityLabel={rawText(t('editorMotion.inverted'))} value={value.inverted} onValueChange={v => { actions.edit('inverted', v); }}
                style={{ minHeight: 44, minWidth: 44 }} />
            {fields.map(field => <Slider key={field.key} label={t(field.label)} value={value[field.key] * (field.key === 'rotation' ? 1 : 100)}
                min={field.min} max={field.max} step={1} format={n => `${formatNumber(n, 0)}${field.key === 'rotation' ? '°' : '%'}`}
                onChange={n => actions.edit(field.key, n / (field.key === 'rotation' ? 1 : 100))} />)}
            <Action label={t('editorMotion.addMask')} disabled={at < 0 || at >= clip.len || (keys.length >= 40 && !keys.some(k => k.frame === at))} onPress={actions.add} />
            {keys.map((key, index) => <View key={index} style={{ gap: ds.space.sm }}>
                <Text style={styles.fieldLabel}>{t('editorMotion.point', { n: index + 1, s: formatNumber(key.frame / fps, 2) })}</Text>
                <EasingChoice label={t('editorMotion.pointEasing', { n: index + 1 })} value={String(key.easing)} onChange={v => actions.easing(index, v)} />
                <Action label={t('editorMotion.deleteMask', { n: index + 1 })} onPress={() => actions.remove(index)} />
            </View>)}
            <Action label={t('editorMotion.resetMask')} onPress={actions.reset} />
            <Text style={styles.muted}>{exportRefusal('mask')}</Text>
        </> : null}
        <Text style={styles.muted}>{t('editorMotion.maskNote')}</Text>
    </View>;
}
