import { Text, View } from 'react-native';
import { t, formatNumber } from '../../../lib/i18n';

import { styles } from '../fullEditorStyles';
import { Action, Choice, Stepper, LabeledInput, PanelHeading } from '../EditorControls';
import { canTrim, SEQUENCE_MAX } from '../../../lib/editorTimeline';
import { type Clip } from '../../../lib/nativeEditorModel';
import { editorTrackLabel } from '../../../lib/editorTrackLabel';

import { seconds } from './EditorRows';
import type { ToolPanelProps } from './types';
export function AdjustPanel({ timeline, selection, selected, selectedMedia, selectedTrack, canMove, moveSelection, removeSelection, patchSelected, adjustStart, adjustLength, changeSpeed,
    toggleReverse, document, markDocument, canvas, updateCanvas, applyTimeline, updateTrack }: Pick<ToolPanelProps, 'timeline' | 'selection' | 'selected' | 'selectedMedia' | 'selectedTrack' |
    'canMove' | 'moveSelection' | 'removeSelection' | 'patchSelected' | 'adjustStart' | 'adjustLength' | 'changeSpeed' | 'toggleReverse' | 'document' | 'markDocument' | 'canvas' | 'updateCanvas'
    | 'applyTimeline' | 'updateTrack'>) {
    const transformOf = (clip: Clip) => ({ x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, flipX: false, flipY: false, ...clip.transform });
    return <>
        <PanelHeading title={selection ? selectedMedia?.name || t('editor.layer', { value1: selection.track[0].toUpperCase(), value2: selection.track.slice(1) }) :
            t('editor.projectSettings')} detail={selection ? seconds(selected?.len, timeline.fps) : t('editor.sequence')} />
        {selection ? <View style={styles.quickActions}><Action label={t('editor.moveLeft')} disabled={!canMove(-1)} onPress={() => moveSelection(-1)} /><Action
            label={t('editor.moveRight')} disabled={!canMove(1)} onPress={() => moveSelection(1)} /><Action label={t('editor.remove')} danger onPress={removeSelection} /></View> : null}
        {selection && selected ? <>
            <Text style={styles.fieldLabel}>{t('editor.track')}</Text><View style={styles.choices}>{timeline.tracks.filter((track) => track.kind === selection.track).map((track) =>
                <Choice key={track.id} label={editorTrackLabel(track)} selected={selected.trackId === track.id} onPress={() => patchSelected({ trackId: track.id })} />)}</View>
            <Stepper label={t('editorCore.startSeconds', { value1: t('editorCore.seconds', { value1: formatNumber(selected.start / timeline.fps, 1) }) })} value={selected.start}
                min={selectedTrack?.locked ? selected.start : 0} max={selectedTrack?.locked ? selected.start : (SEQUENCE_MAX - selected.len)} step={timeline.fps}
                suffix={t('editor.frames')} onChange={value => adjustStart(value - selected.start)} />
            <View style={styles.quickActions}><Action label={t('editorCore.startEarlierFrame')} disabled={!!selectedTrack?.locked} onPress={() => adjustStart(-1)} /><Action
                label={t('editorCore.startLaterFrame')} disabled={!!selectedTrack?.locked} onPress={() => adjustStart(1)} /></View>
            <Stepper label={t('editorCore.durationSeconds', { value1: t('editorCore.seconds', { value1: formatNumber(selected.len / timeline.fps, 1) }) })} value={selected.len}
                min={!canTrim(selected) || selectedTrack?.locked ? selected.len : 1} max={!canTrim(selected) || selectedTrack?.locked ? selected.len : (SEQUENCE_MAX - selected.start)}
                step={timeline.fps} suffix={t('editor.frames')} onChange={value => adjustLength(value - selected.len)} />
            <View style={styles.quickActions}><Action label={t('editorCore.shortenFrame')} disabled={!canTrim(selected) || !!selectedTrack?.locked} onPress={() => adjustLength(-1)}
                /><Action label={t('editorCore.lengthenFrame')} disabled={!canTrim(selected) || !!selectedTrack?.locked} onPress={() => adjustLength(1)} /></View>
            {!canTrim(selected) ? <Text style={styles.body}>{t('editorCore.trimOnWeb')}</Text> : null}
            {selection.track !== 'text' ? <><Stepper label={t('editor.speed')} value={(selected as Clip).rate ?? 1} min={0.1} max={8} step={0.1} suffix="×" onChange={changeSpeed}
                /><Choice label={t('editor.reverse')} selected={!!(selected as Clip).reverse} onPress={toggleReverse} /><Stepper label={t('editor.volume')} value={((selected as
                Clip).volume ?? 1) * 100} min={0} max={200} step={5} suffix="%" onChange={(volume) => patchSelected({ volume: volume / 100 })} /><Stepper label={t('editor.fadein')}
                value={(selected as Clip).fadeIn ?? 0} min={0} max={selected.len} step={1} suffix={t('editor.frames')} onChange={(fadeIn) => patchSelected({ fadeIn })} /><Stepper
                label={t('editor.fadeout')} value={(selected as Clip).fadeOut ?? 0} min={0} max={selected.len} step={1} suffix={t('editor.frames')} onChange={(fadeOut) => patchSelected({
                fadeOut })} /><Stepper label={t('editor.pan')} value={(selected as Clip).pan ?? 0} min={-1} max={1} step={0.1} onChange={(pan) => patchSelected({ pan })} /></> : null}
            {selection.track === 'video' ? <><Stepper label={t('editor.scale')} value={transformOf(selected as Clip).scale * 100} min={5} max={800} step={5} suffix="%" onChange={(value) =>
                patchSelected({ transform: { ...transformOf(selected as Clip), scale: value / 100 } })} /><Stepper label={t('editor.rotation')} value={transformOf(selected as
                Clip).rotation} min={-360} max={360} step={5} suffix="°" onChange={(rotation) => patchSelected({ transform: { ...transformOf(selected as Clip), rotation } })} /><Stepper
                label={t('editor.opacity')} value={transformOf(selected as Clip).opacity * 100} min={0} max={100} step={5} suffix="%" onChange={(value) => patchSelected({ transform: {
                ...transformOf(selected as Clip), opacity: value / 100 } })} /><View style={styles.choices}><Choice label={t('editor.contain')} selected={((selected as Clip).fit ??
                'contain') === 'contain'} onPress={() => patchSelected({ fit: 'contain' })} /><Choice label={t('editor.cover')} selected={(selected as Clip).fit === 'cover'} onPress={() =>
                    patchSelected({ fit: 'cover' })} /></View></> : null}
        </> : null}
        <LabeledInput label={t('editor.brief')} value={document.brief || ''} multiline onChangeText={(brief) => markDocument({ ...document, brief: brief.slice(0, 6000) })} />
        <Text style={styles.fieldLabel}>{t('editor.shape')}</Text><View style={styles.choices}>{(['16:9', '9:16', '1:1'] as const).map((value) => <Choice key={value} label={value}
            selected={canvas.aspect_ratio === value} onPress={() => updateCanvas({ aspect_ratio: value })} />)}</View>
        <Text style={styles.fieldLabel}>{t('editor.rate')}</Text><View style={styles.choices}>{([24, 25, 30, 60] as const).map((value) => <Choice key={value} label={`${value}`}
            selected={canvas.frame_rate === value} onPress={() => updateCanvas({ frame_rate: value })} />)}</View>
        <Text style={styles.fieldLabel}>{t('editor.canvascolour')}</Text><View style={styles.choices}>{['#000000', '#ffffff', '#15211f', '#301c36', '#17233f'].map((value) => <Choice
            key={value} label={value} selected={timeline.background === value} onPress={() => applyTimeline({ ...timeline, background: value })} />)}</View>
        <PanelHeading title={t('editor.tracks')} detail={t('editor.total', { value1: timeline.tracks.length })} />
        {timeline.tracks.map((track) => <View key={track.id} style={styles.trackControl}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{editorTrackLabel(track)}</Text><Text
            style={styles.muted}>{t(`editor.track.${track.kind}`)}</Text></View><Choice label={t('editor.lock')} selected={track.locked} onPress={() => updateTrack(track, { locked:
            !track.locked })} compact /><Choice label={t('editor.mute')} selected={track.muted} onPress={() => updateTrack(track, { muted: !track.muted })} compact /><Choice
            label={t('editor.hide')} selected={track.hidden} onPress={() => updateTrack(track, { hidden: !track.hidden })} compact /></View>)}
    </>;
}
