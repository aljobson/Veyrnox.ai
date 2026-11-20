import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { ANIMATION_CATALOG, LOOP_CATALOG } from '../../../../../../app/veyrnox/_lib/editorAnimationCatalog.mjs';
import { t, formatNumber } from '../../../lib/i18n';
import { touchTarget } from '../../../lib/a11y';
import type { AnimationMode } from '../../../lib/editorTextEdit';
import { ds } from '../../../theme';
import { styles } from '../fullEditorStyles';
import { Action, Choice, PanelHeading } from '../EditorControls';
import { SegmentedChoice } from './SegmentedChoice';
import { Slider } from './Slider';
import type { ToolPanelProps } from './types';
export function AnimationPanel({ selection, selected, textActions }: Pick<ToolPanelProps, 'selection' | 'selected' | 'textActions'>) {
    const [mode, setMode] = useState<AnimationMode>('in');
    const [chosen, setChosen] = useState({ in: 'fade', out: 'fade', loop: 'sway' });
    const [duration, setDuration] = useState(15), [period, setPeriod] = useState(60), [amount, setAmount] = useState(50), [restart, setRestart] = useState(false);
    const animationLabels: Record<string, { name: string; description: string }> = {
        "none": { name: t('editorText.animationName0'), description: t('editorText.animationDescription0') },
        "fade": { name: t('editorText.animationName1'), description: t('editorText.animationDescription1') },
        "slide-left": { name: t('editorText.animationName2'), description: t('editorText.animationDescription2') },
        "slide-right": { name: t('editorText.animationName3'), description: t('editorText.animationDescription3') },
        "slide-up": { name: t('editorText.animationName4'), description: t('editorText.animationDescription4') },
        "slide-down": { name: t('editorText.animationName5'), description: t('editorText.animationDescription5') },
        "zoom": { name: t('editorText.animationName6'), description: t('editorText.animationDescription6') },
        "spin": { name: t('editorText.animationName7'), description: t('editorText.animationDescription7') },
        "bounce": { name: t('editorText.animationName8'), description: t('editorText.animationDescription8') },
        "wipe-left": { name: t('editorText.animationName9'), description: t('editorText.animationDescription9') },
        "wipe-right": { name: t('editorText.animationName10'), description: t('editorText.animationDescription10') },
        "wipe-up": { name: t('editorText.animationName11'), description: t('editorText.animationDescription11') },
        "wipe-down": { name: t('editorText.animationName12'), description: t('editorText.animationDescription12') },
    };
    const loopLabels: Record<string, { name: string; description: string }> = {
        "none": { name: t('editorText.loopName0'), description: t('editorText.loopDescription0') },
        "float": { name: t('editorText.loopName1'), description: t('editorText.loopDescription1') },
        "pulse": { name: t('editorText.loopName2'), description: t('editorText.loopDescription2') },
        "spin": { name: t('editorText.loopName3'), description: t('editorText.loopDescription3') },
        "drift": { name: t('editorText.loopName4'), description: t('editorText.loopDescription4') },
        "sway": { name: t('editorText.loopName5'), description: t('editorText.loopDescription5') },
        "wobble": { name: t('editorText.loopName6'), description: t('editorText.loopDescription6') },
        "bounce": { name: t('editorText.loopName7'), description: t('editorText.loopDescription7') },
    };
    const labels = mode === 'loop' ? loopLabels : animationLabels, catalog = mode === 'loop' ? LOOP_CATALOG : ANIMATION_CATALOG;
    const current = selected?.animation?.[mode === 'loop' ? 'combo' : mode] ?? 'none';
    const timing = (frames: number) => t('editorText.framesSeconds', { frames: formatNumber(frames, 0), seconds: (frames / 30).toFixed(2) });
    return <>
        <PanelHeading title={t('editor.animation')} detail={selection ? t('editor.layermotion') : t('editor.selectalayer')} />
        {selected && (selection?.track === 'text' || selection?.track === 'video') ? <>
            <SegmentedChoice label={t('editorText.mode')} value={mode} options={[
                { value: 'in', label: t('editorText.in') }, { value: 'out', label: t('editorText.out') }, { value: 'loop', label: t('editorText.loop') },
            ]} onChange={value => setMode(value as AnimationMode)} />
            {catalog.map(preset => <View key={preset.id} style={local.row}>
                <Choice label={labels[preset.id].name} selected={chosen[mode] === preset.id} onPress={() => setChosen(value => ({ ...value, [mode]: preset.id }))} />
                <Text style={styles.panelDetail}>{labels[preset.id].description}</Text>
            </View>)}
            <Text style={styles.body}>{t('editorText.current', { name: labels[current]?.name ?? current })}</Text>
            {mode === 'loop' ? <>
                <Slider label={t('editorText.period')} value={period} min={1} max={600} step={1} format={timing} onChange={setPeriod} />
                <Slider label={t('editorText.strength')} value={amount} min={0} max={100} step={1}
                    format={value => t('editorText.percent', { value: formatNumber(value, 0) })} onChange={setAmount} />
            </> : <Slider label={t('editorText.duration')} value={duration} min={1} max={120} step={1} format={timing} onChange={setDuration} />}
            <View style={local.row}><Text style={styles.fieldLabel}>{t('editorText.restart')}</Text>
                <Switch accessibilityLabel={t('editorText.restart')} value={restart} onValueChange={setRestart} style={touchTarget} /></View>
            {(selected.animation?.offset ?? 0) > 0 && !restart ? <Text style={styles.panelDetail}>{t('editorText.trimmed')}</Text> : null}
            <Action label={t('editorText.apply')} onPress={() => textActions?.applyAnimation(mode, chosen[mode], { duration, period, amount: amount / 100, restart })} />
            <Action label={t('editorText.clear')} onPress={() => textActions?.resetAnimation()} />
        </> : <Text style={styles.body}>{t('editorText.visualSelection')}</Text>}
        <Text style={styles.panelDetail}>{t('editorText.previewAnimation')}</Text>
    </>;
}
const local = StyleSheet.create({ row: { gap: ds.space.xs } });
